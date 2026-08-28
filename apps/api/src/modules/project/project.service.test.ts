import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createVirtualUser } from "@/modules/account/users/users.service";
import { fileReferences, files } from "@/modules/file/schema";
import { issueDetails } from "@/modules/issue/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { procurementDetails } from "@/modules/procurement/schema";
import { setSetting } from "@/modules/settings/settings.service";
import { createRole, deleteRole, listRoles, parseCapabilities, resolveGuestRole } from "./project.roles";
import {
  addMember,
  composeProjectWithTags,
  createProject,
  getMemberCapabilities,
  getProjectByShortId,
  hasCapability,
  isMember,
  isProjectVersionConflict,
  listMembers,
  listProjectChildren,
  listProjects,
  removeMember,
  resolveAssignableMember,
  resolveProjectId,
  setProjectParent,
  softDeleteProject,
  updateMember,
  updateProject,
} from "./project.service";
import { projectRoles } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/** Resolve the seeded "Reader" preset role id for a project. */
async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Reader")!.id;
}

/**
 * Seed a live issue / procurement child item under a project: the base `items`
 * row, its `*_details` link, and an owner relation tuple. Returns the item id.
 */
async function seedChildItem(creator: string, projectId: string, type: "issue" | "procurement"): Promise<string> {
  const itemId = nanoid();
  const now = new Date().toISOString();
  await db.insert(items).values({
    id: itemId,
    shortId: nanoid(),
    type,
    title: `${type} item`,
    status: "todo",
    creatorId: creator,
    updatedAt: now,
  }).run();
  if (type === "issue")
    await db.insert(issueDetails).values({ itemId, projectId }).run();
  else
    await db.insert(procurementDetails).values({ itemId, projectId, itemName: "Widget" }).run();
  await db.insert(relationTuples).values({
    id: nanoid(),
    namespace: "item",
    objectId: itemId,
    relation: "owner",
    subjectNamespace: "user",
    subjectId: creator,
    subjectRelation: null,
    createdBy: creator,
    createdAt: now,
  }).run();
  return itemId;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-project-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("createProject", () => {
  test("writes the project row, seeds roles, and adds the creator as a pm member", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Bridge", creatorId: creator });

    expect(project.shortId).toHaveLength(8);
    expect(project.name).toBe("Bridge");
    expect(project.status).toBe("active");
    expect(project.version).toBe(1);
    expect(project.code).toContain("p-");

    const roles = await listRoles(db, project.id);
    expect(roles.map(r => r.name).sort()).toEqual(["Commenter", "Guest", "Project Owner", "Reader", "Writer"]);
    const pmRole = roles.find(r => r.name === "Project Owner")!;
    expect(parseCapabilities(pmRole.capabilities)).toContain("project.manage");
    expect(pmRole.kind).toBe("owner");
    const guestRole = roles.find(r => r.name === "Guest")!;
    expect(guestRole.kind).toBe("guest");
    expect(parseCapabilities(guestRole.capabilities)).toEqual([]);

    const members = await listMembers(db, project.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(creator);
    expect(members[0]!.roleId).toBe(pmRole.id);
  });

  test("lowercases an auto-generated code", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Bridge", creatorId: creator });
    expect(project.code).toMatch(/^p-[0-9a-z]+$/);
    expect(project.code).toBe(project.code.toLowerCase());
  });

  test("lowercases a supplied uppercase code", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Tower", code: "TOWER-1", creatorId: creator });
    expect(project.code).toBe("tower-1");
  });

  test("persists description and tags", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, {
      name: "Plant",
      creatorId: creator,
      description: "A plant",
      tags: ["municipal", "priority"],
    });
    const view = await getProjectByShortId(db, project.shortId);
    expect(view?.description).toBe("A plant");

    const listed = await listProjects(db, {});
    const tags = listed.data.find(p => p.id === project.shortId)!.tags.map(t => t.name).sort();
    expect(tags).toEqual(["municipal", "priority"]);
  });
});

describe("members", () => {
  test("adds a real member and a virtual-user member, resolving name + isVirtual", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);

    const real = await addMember(db, project.id, { roleId, userId: bob, title: "Engineer" });
    expect(real.userId).toBe(bob);
    expect(real.title).toBe("Engineer");
    expect(real.name).toBe("Bob");
    expect(real.isVirtual).toBe(false);

    const virtualUser = await createVirtualUser(db, { username: "field-worker", name: "Field Worker" });
    const virtual = await addMember(db, project.id, { roleId, userId: virtualUser!.id });
    expect(virtual.userId).toBe(virtualUser!.id);
    expect(virtual.name).toBe("Field Worker");
    expect(virtual.isVirtual).toBe(true);

    const members = await listMembers(db, project.id);
    expect(members).toHaveLength(3); // creator + 2
  });

  test("removeMember deletes the row", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);
    const member = await addMember(db, project.id, { roleId, userId: bob });

    expect(await removeMember(db, project.id, member.id)).toBe(true);
    expect(await removeMember(db, project.id, member.id)).toBe(false);
  });
});

describe("member authz guards (02-F3/F4)", () => {
  test("addMember rejects a non-existent userId (F4)", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);
    expect(addMember(db, project.id, { roleId, userId: "ghost" })).rejects.toThrow();
  });

  test("addMember rejects a duplicate real member (F4)", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);
    await addMember(db, project.id, { roleId, userId: bob });
    expect(addMember(db, project.id, { roleId, userId: bob })).rejects.toThrow();
  });

  test("removeMember refuses to remove the last owner (F3)", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const ownerMember = (await listMembers(db, project.id)).find(m => m.userId === creator)!;
    expect(removeMember(db, project.id, ownerMember.id)).rejects.toThrow();
  });

  test("updateMember refuses to demote the last owner (F3)", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const ownerMember = (await listMembers(db, project.id)).find(m => m.userId === creator)!;
    const readerId = await memberRoleId(project.id);
    expect(updateMember(db, project.id, ownerMember.id, { roleId: readerId })).rejects.toThrow();
  });

  test("an owner can be removed once a second owner exists (F3)", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const ownerRole = (await listRoles(db, project.id)).find(r => r.kind === "owner")!;
    // A second owner makes the first one removable without leaving the project ownerless.
    await addMember(db, project.id, { roleId: ownerRole.id, userId: bob });
    const ownerMember = (await listMembers(db, project.id)).find(m => m.userId === creator)!;
    expect(await removeMember(db, project.id, ownerMember.id)).toBe(true);
  });
});

describe("updateProject", () => {
  test("bumps version and applies the patch", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const updated = await updateProject(db, project.shortId, { name: "P2", status: "archived" });
    expect(isProjectVersionConflict(updated)).toBe(false);
    if (isProjectVersionConflict(updated))
      return;
    expect(updated?.name).toBe("P2");
    expect(updated?.status).toBe("archived");
    expect(updated!.version).toBe(2);
  });

  test("expectedVersion match applies the patch and bumps version", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    expect(project.version).toBe(1);
    const updated = await updateProject(db, project.shortId, { name: "P2", expectedVersion: 1 });
    expect(isProjectVersionConflict(updated)).toBe(false);
    if (isProjectVersionConflict(updated))
      return;
    expect(updated?.name).toBe("P2");
    expect(updated!.version).toBe(2);
  });

  test("expectedVersion mismatch returns a conflict with the current row and writes nothing", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    // Bump the version once so the stored version (2) diverges from a stale client's 1.
    await updateProject(db, project.shortId, { name: "P2" });

    const conflict = await updateProject(db, project.shortId, { name: "stale", expectedVersion: 1 });
    expect(isProjectVersionConflict(conflict)).toBe(true);
    if (!isProjectVersionConflict(conflict))
      return;
    expect(conflict.current.version).toBe(2);
    expect(conflict.current.name).toBe("P2");

    // The stale write must not have landed.
    const fresh = await getProjectByShortId(db, project.shortId);
    expect(fresh?.name).toBe("P2");
    expect(fresh?.version).toBe(2);
  });

  test("code is immutable: a sneaked-in code is ignored", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", code: "ORIG-1", creatorId: creator });
    expect(project.code).toBe("orig-1");

    // Force a `code` field past the typed input to prove the service never
    // patches it (the column is dropped from the patched-keys loop).
    const updated = await updateProject(db, project.shortId, { name: "P2", code: "HACKED" } as unknown as Parameters<typeof updateProject>[2]);
    if (isProjectVersionConflict(updated))
      return;
    expect(updated?.name).toBe("P2");
    expect(updated?.code).toBe("orig-1");
  });
});

describe("softDeleteProject", () => {
  test("hides the project from reads but keeps member rows", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await softDeleteProject(db, project.shortId);

    expect(await getProjectByShortId(db, project.shortId)).toBeUndefined();
    expect(await resolveProjectId(db, project.shortId)).toBeNull();
    expect(await listMembers(db, project.id)).toHaveLength(1);
  });

  test("cascades the soft-delete to the project's issue / procurement items and tears down their tuples", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const issueItemId = await seedChildItem(creator, project.id, "issue");
    const procItemId = await seedChildItem(creator, project.id, "procurement");

    // Live before the project delete.
    expect((await db.select().from(items).where(eq(items.id, issueItemId)).get())!.deletedAt).toBeNull();
    expect(await db.select().from(relationTuples).where(eq(relationTuples.objectId, issueItemId)).all()).toHaveLength(1);

    await softDeleteProject(db, project.shortId);

    // Both children are now soft-deleted in the same operation.
    expect((await db.select().from(items).where(eq(items.id, issueItemId)).get())!.deletedAt).not.toBeNull();
    expect((await db.select().from(items).where(eq(items.id, procItemId)).get())!.deletedAt).not.toBeNull();
    // Their relation tuples are gone.
    expect(await db.select().from(relationTuples).where(eq(relationTuples.objectId, issueItemId)).all()).toHaveLength(0);
    expect(await db.select().from(relationTuples).where(eq(relationTuples.objectId, procItemId)).all()).toHaveLength(0);
  });

  test("re-soft-deleting an already-deleted project does not re-stamp child items", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const issueItemId = await seedChildItem(creator, project.id, "issue");

    await softDeleteProject(db, project.shortId);
    const firstStamp = (await db.select().from(items).where(eq(items.id, issueItemId)).get())!.deletedAt;

    // A second call sees the project already soft-deleted and must not touch children again.
    await softDeleteProject(db, project.shortId);
    const secondStamp = (await db.select().from(items).where(eq(items.id, issueItemId)).get())!.deletedAt;
    expect(secondStamp).toBe(firstStamp);
  });
});

describe("listProjects", () => {
  test("paginates, filters by status, excludes soft-deleted", async () => {
    const creator = await seedUser("Alice");
    await createProject(db, { name: "A", creatorId: creator });
    const toArchive = await createProject(db, { name: "B", creatorId: creator });
    await updateProject(db, toArchive.shortId, { status: "archived" });
    const deleted = await createProject(db, { name: "C", creatorId: creator });
    await softDeleteProject(db, deleted.shortId);

    const all = await listProjects(db, {});
    expect(all.total).toBe(2);

    const archived = await listProjects(db, { status: "archived" });
    expect(archived.total).toBe(1);
    expect(archived.data[0]!.name).toBe("B");
  });

  test("excludeArchived hides archived projects unless status is explicit", async () => {
    const creator = await seedUser("Alice");
    await createProject(db, { name: "Live", creatorId: creator });
    const old = await createProject(db, { name: "Old", creatorId: creator });
    await updateProject(db, old.shortId, { status: "archived" });

    // Default chip ("All"): archived hidden.
    const visible = await listProjects(db, { excludeArchived: true });
    expect(visible.data.map(p => p.name)).toEqual(["Live"]);

    // Archived chip: an explicit status wins over excludeArchived.
    const archived = await listProjects(db, { status: "archived", excludeArchived: true });
    expect(archived.data.map(p => p.name)).toEqual(["Old"]);
  });

  test("filters by tag", async () => {
    const creator = await seedUser("Alice");
    await createProject(db, { name: "Tagged", creatorId: creator, tags: ["alpha"] });
    await createProject(db, { name: "Untagged", creatorId: creator });

    const listed = await listProjects(db, {});
    const tag = listed.data.flatMap(p => p.tags).find(t => t.name === "alpha")!;
    const byTag = await listProjects(db, { tagIds: [tag.id] });
    expect(byTag.total).toBe(1);
    expect(byTag.data[0]!.name).toBe("Tagged");
  });

  test("tagIds filters by OR/union, not AND", async () => {
    const creator = await seedUser("Alice");
    await createProject(db, { name: "A", creatorId: creator, tags: ["alpha"] });
    await createProject(db, { name: "B", creatorId: creator, tags: ["beta", "alpha"] });
    await createProject(db, { name: "C", creatorId: creator, tags: ["gamma"] });

    // 0 tags → no filter (all projects)
    expect((await listProjects(db, { tagIds: [] })).total).toBe(3);

    // 1 tag → just that project
    expect((await listProjects(db, { tagIds: ["gamma"] })).data.map(p => p.name)).toEqual(["C"]);

    // many tags → OR: alpha∪gamma = A,B,C (AND would be empty)
    expect((await listProjects(db, { tagIds: ["alpha", "gamma"] })).data.map(p => p.name).sort())
      .toEqual(["A", "B", "C"]);

    // AND-not-applied: alpha∪beta = A (alpha) and B (both); not just B
    expect((await listProjects(db, { tagIds: ["alpha", "beta"] })).data.map(p => p.name).sort())
      .toEqual(["A", "B"]);
  });

  test("a literal % or _ in the query is matched literally, not as a wildcard", async () => {
    const creator = await seedUser("Alice");
    await createProject(db, { name: "a%b", creatorId: creator });
    await createProject(db, { name: "axb", creatorId: creator });
    await createProject(db, { name: "a_b", creatorId: creator });
    await createProject(db, { name: "acb", creatorId: creator });

    // `%` must not act as a wildcard: only the literal "a%b" matches.
    const pct = await listProjects(db, { q: "a%b" });
    expect(pct.data.map(p => p.name)).toEqual(["a%b"]);

    // `_` must not match a single arbitrary char: only the literal "a_b".
    const underscore = await listProjects(db, { q: "a_b" });
    expect(underscore.data.map(p => p.name)).toEqual(["a_b"]);
  });

  test("memberUserId scopes the list to the caller's projects", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    await createProject(db, { name: "Owned", creatorId: owner });

    const mine = await listProjects(db, { memberUserId: owner });
    expect(mine.total).toBe(1);
    const theirs = await listProjects(db, { memberUserId: outsider });
    expect(theirs.total).toBe(0);
  });
});

describe("access helpers", () => {
  test("isMember reflects membership and fails closed for non-members", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const outsider = await seedUser("Eve");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });

    expect(await isMember(db, project.id, creator)).toBe(true);
    expect(await isMember(db, project.id, bob)).toBe(true);
    expect(await isMember(db, project.id, outsider)).toBe(false);
  });

  test("capabilities derive from the member's role", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const carol = await seedUser("Carol");
    const outsider = await seedUser("Eve");
    const project = await createProject(db, { name: "P", creatorId: creator });

    // Reader role has view capabilities but no manage caps.
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    // A custom role granting procurement management.
    const manager = await createRole(db, project.id, { name: "Procurement Manager", capabilities: ["procurement.view", "procurement.manage"] });
    await addMember(db, project.id, { roleId: manager.id, userId: carol });

    expect((await getMemberCapabilities(db, project.id, creator))?.has("project.manage")).toBe(true);
    expect(await hasCapability(db, project.id, bob, "issue.view")).toBe(true);
    expect(await hasCapability(db, project.id, bob, "issue.manage")).toBe(false);
    expect(await hasCapability(db, project.id, carol, "procurement.manage")).toBe(true);
    expect(await getMemberCapabilities(db, project.id, outsider)).toBeNull();
  });

  test("resolveAssignableMember validates ownership", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const projectA = await createProject(db, { name: "A", creatorId: creator });
    const projectB = await createProject(db, { name: "B", creatorId: creator });
    const member = await addMember(db, projectA.id, { roleId: await memberRoleId(projectA.id), userId: bob });

    const resolved = await resolveAssignableMember(db, projectA.id, member.id);
    expect(resolved?.id).toBe(member.id);
    expect(resolved?.userId).toBe(bob);

    expect(await resolveAssignableMember(db, projectB.id, member.id)).toBeNull();
    expect(await resolveAssignableMember(db, projectA.id, "missing")).toBeNull();
  });
});

describe("roles engine", () => {
  test("seedDefaultRoles produces Owner(kind=owner,12caps)+Guest(kind=guest,empty)+Reader+Commenter+Writer", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roles = await listRoles(db, project.id);
    expect(roles).toHaveLength(5);

    const owner = roles.find(r => r.name === "Project Owner")!;
    expect(owner.isSystem).toBe(1);
    expect(owner.kind).toBe("owner");
    expect(parseCapabilities(owner.capabilities)).toHaveLength(12);
    expect(parseCapabilities(owner.capabilities)).toContain("issue.view");
    expect(parseCapabilities(owner.capabilities)).toContain("project.manage");

    const guest = roles.find(r => r.name === "Guest")!;
    expect(guest.isSystem).toBe(1);
    expect(guest.kind).toBe("guest");
    expect(parseCapabilities(guest.capabilities)).toEqual([]);

    const reader = roles.find(r => r.name === "Reader")!;
    expect(reader.isSystem).toBe(0);
    expect(reader.kind).toBeNull();
    const readerCaps = parseCapabilities(reader.capabilities);
    expect(readerCaps.sort()).toEqual(["files.view", "issue.view", "procurement.view"]);

    const commenter = roles.find(r => r.name === "Commenter")!;
    const commenterCaps = parseCapabilities(commenter.capabilities);
    expect(commenterCaps).toContain("issue.comment");
    expect(commenterCaps).toContain("procurement.comment");

    const writer = roles.find(r => r.name === "Writer")!;
    const writerCaps = parseCapabilities(writer.capabilities);
    expect(writerCaps).toContain("files.manage");
    expect(writerCaps).toContain("categories.manage");
  });

  test("resolveGuestRole returns the project's Guest role", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const guest = await resolveGuestRole(db, project.id);
    expect(guest).toBeDefined();
    expect(guest!.kind).toBe("guest");
    expect(parseCapabilities(guest!.capabilities)).toEqual([]);
  });

  test("deleteRole reassigns holders to Guest and succeeds (no 'in_use' error)", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const reader = (await listRoles(db, project.id)).find(r => r.name === "Reader")!;
    const guest = (await listRoles(db, project.id)).find(r => r.name === "Guest")!;

    const member = await addMember(db, project.id, { roleId: reader.id, userId: bob });

    // Deleting an in-use custom role should succeed, not return "in_use"
    const result = await deleteRole(db, project.id, reader.id);
    expect(result).toBe("deleted");

    // Bob should now be on the Guest role
    const members = await listMembers(db, project.id);
    const bobMember = members.find(m => m.id === member.id)!;
    expect(bobMember.roleId).toBe(guest.id);
  });

  test("deleteRole refuses a system role", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const owner = (await listRoles(db, project.id)).find(r => r.kind === "owner")!;
    const guestRole = (await listRoles(db, project.id)).find(r => r.kind === "guest")!;

    expect(await deleteRole(db, project.id, owner.id)).toBe("system");
    expect(await deleteRole(db, project.id, guestRole.id)).toBe("system");
  });

  test("deleteRole degrades cleanly when the Guest role is missing", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const reader = (await listRoles(db, project.id)).find(r => r.name === "Reader")!;
    const writer = (await listRoles(db, project.id)).find(r => r.name === "Writer")!;
    const guest = (await resolveGuestRole(db, project.id))!;

    // Simulate a corrupted project: drop the Guest role (the delete-fallback target).
    await db.delete(projectRoles).where(eq(projectRoles.id, guest.id)).run();

    // A held role can't be reassigned without Guest → blocks with a clean error
    // (ValidationError → 422) instead of raising a raw FK constraint failure.
    await addMember(db, project.id, { roleId: reader.id, userId: bob });
    await expect(deleteRole(db, project.id, reader.id)).rejects.toMatchObject({ statusCode: 422 });
    // The role and its holder are untouched.
    expect((await listRoles(db, project.id)).some(r => r.id === reader.id)).toBe(true);

    // An unheld role is still safe to delete directly.
    expect(await deleteRole(db, project.id, writer.id)).toBe("deleted");
    expect((await listRoles(db, project.id)).some(r => r.id === writer.id)).toBe(false);
  });
});

/** Insert a usable cover file reference and return its id. */
async function seedCoverReference(uploadedBy: string): Promise<string> {
  const fileId = nanoid();
  const refId = nanoid();
  const now = new Date().toISOString();
  await db.insert(files).values({
    id: fileId,
    sha256: `sha-${fileId}`,
    size: 1,
    mimetype: "image/png",
    storageDriver: "local",
    storageKey: `key-${fileId}`,
    refCount: 1,
    uploadedBy,
  }).run();
  await db.insert(fileReferences).values({
    id: refId,
    fileId,
    ownerType: "project_cover",
    ownerId: "defaults",
    filename: "cover.png",
    createdBy: uploadedBy,
    createdAt: now,
  }).run();
  return refId;
}

describe("project defaults on create", () => {
  test("always creates the project active, ignoring any stale default-status setting", async () => {
    const creator = await seedUser("Alice");
    // A leftover setting from before the default-status feature was removed must
    // have no effect: new projects are always created active.
    await setSetting(db, "project.defaults.status", "archived");

    const created = await createProject(db, { name: "Always", creatorId: creator });
    expect(created.status).toBe("active");
  });

  test("applies the default cover reference when the payload omits it", async () => {
    const creator = await seedUser("Alice");
    const refId = await seedCoverReference(creator);
    await setSetting(db, "project.defaults.coverReferenceId", refId);

    const withCover = await createProject(db, { name: "Cover", creatorId: creator });
    expect(withCover.coverReferenceId).toBe(refId);
  });

  test("ignores a dangling default cover reference (create stays safe)", async () => {
    const creator = await seedUser("Alice");
    await setSetting(db, "project.defaults.coverReferenceId", "does-not-exist");

    const created = await createProject(db, { name: "NoCover", creatorId: creator });
    expect(created.coverReferenceId).toBeNull();
  });
});

describe("project sections on create", () => {
  test("the default preset mounts issues / procurement / files, in tab order", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Plain", creatorId: creator });

    const view = await composeProjectWithTags(db, project);
    expect(view.sections).toEqual(["issues", "procurement", "files"]);
  });

  test("the ship preset mounts the six maritime-project sections, in preset order", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Vessel", creatorId: creator, preset: "ship" });

    const view = await composeProjectWithTags(db, project);
    expect(view.sections).toEqual([
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
    ]);
  });

  test("listProjects carries each row's own sections", async () => {
    const creator = await seedUser("Alice");
    const plain = await createProject(db, { name: "Plain", creatorId: creator });
    const vessel = await createProject(db, { name: "Vessel", creatorId: creator, preset: "ship" });

    const listed = await listProjects(db, {});

    expect(listed.data.find(p => p.id === plain.shortId)!.sections)
      .toEqual(["issues", "procurement", "files"]);
    expect(listed.data.find(p => p.id === vessel.shortId)!.sections)
      .toEqual(["issues", "procurement", "files", "ship-profile", "equipment", "worklist"]);
  });
});

describe("project hierarchy", () => {
  test("createProject links the new project under an existing parent", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });

    const child = await createProject(db, { name: "Leg", creatorId: creator, parentId: parent.shortId });

    expect(child.parentId).toBe(parent.id);
    expect((await listProjectChildren(db, parent.shortId)).map(p => p.id)).toEqual([child.id]);
  });

  test("createProject rejects a missing or soft-deleted parent, writing nothing", async () => {
    const creator = await seedUser("Alice");
    const gone = await createProject(db, { name: "Gone", creatorId: creator });
    await softDeleteProject(db, gone.shortId);

    await expect(createProject(db, { name: "Orphan", creatorId: creator, parentId: "nosuchid" }))
      .rejects
      .toMatchObject({ statusCode: 404 });
    await expect(createProject(db, { name: "Orphan", creatorId: creator, parentId: gone.shortId }))
      .rejects
      .toMatchObject({ statusCode: 404 });

    expect((await listProjects(db, {})).data.some(p => p.name === "Orphan")).toBe(false);
  });

  test("createProject refuses a parent that is itself a sub-project (one level only)", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });
    const child = await createProject(db, { name: "Leg", creatorId: creator, parentId: parent.shortId });

    await expect(createProject(db, { name: "Deep", creatorId: creator, parentId: child.shortId }))
      .rejects
      .toMatchObject({ statusCode: 422 });
  });

  test("setProjectParent links and unlinks, bumping the version each time", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });
    const child = await createProject(db, { name: "Leg", creatorId: creator });

    const linked = await setProjectParent(db, child.shortId, parent.shortId);
    expect(linked?.parentId).toBe(parent.id);
    expect(linked?.version).toBe(child.version + 1);

    const unlinked = await setProjectParent(db, child.shortId, null);
    expect(unlinked?.parentId).toBeNull();
    expect(await listProjectChildren(db, parent.shortId)).toHaveLength(0);
  });

  test("setProjectParent returns undefined for an unknown project", async () => {
    expect(await setProjectParent(db, "nosuchid", null)).toBeUndefined();
  });

  test("setProjectParent rejects a project parenting itself", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Self", creatorId: creator });

    await expect(setProjectParent(db, project.shortId, project.shortId))
      .rejects
      .toMatchObject({ statusCode: 422 });
    expect((await getProjectByShortId(db, project.shortId))?.parentId).toBeNull();
  });

  test("setProjectParent rejects a missing or soft-deleted parent", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Leg", creatorId: creator });
    const gone = await createProject(db, { name: "Gone", creatorId: creator });
    await softDeleteProject(db, gone.shortId);

    await expect(setProjectParent(db, project.shortId, "nosuchid"))
      .rejects
      .toMatchObject({ statusCode: 404 });
    await expect(setProjectParent(db, project.shortId, gone.shortId))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });

  test("setProjectParent refuses a parent that already has a parent", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });
    const child = await createProject(db, { name: "Leg", creatorId: creator, parentId: parent.shortId });
    const loose = await createProject(db, { name: "Loose", creatorId: creator });

    await expect(setProjectParent(db, loose.shortId, child.shortId))
      .rejects
      .toMatchObject({ statusCode: 422 });
    expect((await getProjectByShortId(db, loose.shortId))?.parentId).toBeNull();
  });

  test("setProjectParent refuses to give a parent to a project that already has children", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });
    await createProject(db, { name: "Leg", creatorId: creator, parentId: parent.shortId });
    const other = await createProject(db, { name: "Other", creatorId: creator });

    await expect(setProjectParent(db, parent.shortId, other.shortId))
      .rejects
      .toMatchObject({ statusCode: 422 });
    expect((await getProjectByShortId(db, parent.shortId))?.parentId).toBeNull();
  });

  test("listProjectChildren skips soft-deleted children and unknown parents", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });
    const live = await createProject(db, { name: "Live", creatorId: creator, parentId: parent.shortId });
    const dead = await createProject(db, { name: "Dead", creatorId: creator, parentId: parent.shortId });
    await softDeleteProject(db, dead.shortId);

    expect((await listProjectChildren(db, parent.shortId)).map(p => p.id)).toEqual([live.id]);
    expect(await listProjectChildren(db, "nosuchid")).toEqual([]);
  });

  test("soft-deleting a parent UNLINKS its children instead of deleting them", async () => {
    const creator = await seedUser("Alice");
    const parent = await createProject(db, { name: "Fleet", creatorId: creator });
    const child = await createProject(db, { name: "Leg", creatorId: creator, parentId: parent.shortId });

    await softDeleteProject(db, parent.shortId);

    const after = await getProjectByShortId(db, child.shortId);
    expect(after).toBeDefined();
    expect(after!.deletedAt).toBeNull();
    expect(after!.parentId).toBeNull();
  });
});
