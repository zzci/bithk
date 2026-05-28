import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { setSetting } from "@/modules/settings/settings.service";
import { listCategories } from "./project.categories";
import {
  createGlobalCategory,
  deleteGlobalCategory,
  listGlobalCategories,
  updateGlobalCategory,
} from "./project.global-categories";
import { createRole, listRoles, parseCapabilities } from "./project.roles";
import {
  addMember,
  createProject,
  getMemberCapabilities,
  getProjectByShortId,
  hasCapability,
  isMember,
  listMembers,
  listProjects,
  removeMember,
  resolveAssignableMember,
  resolveProjectId,
  softDeleteProject,
  updateMember,
  updateProject,
} from "./project.service";

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

/** Resolve the seeded baseline "Member" role id for a project. */
async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Member")!.id;
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
    expect(project.code).toContain("P-");

    const roles = await listRoles(db, project.id);
    expect(roles.map(r => r.name).sort()).toEqual(["Member", "Project Owner"]);
    const pmRole = roles.find(r => r.isSystem === 1)!;
    expect(parseCapabilities(pmRole.capabilities)).toContain("project.manage");

    const members = await listMembers(db, project.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(creator);
    expect(members[0]!.roleId).toBe(pmRole.id);
  });

  test("accepts a provided code", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Tower", code: "TOWER-1", creatorId: creator });
    expect(project.code).toBe("TOWER-1");
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
  test("adds a real and a virtual member", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);

    const real = await addMember(db, project.id, { roleId, userId: bob, title: "Engineer" });
    expect(real.userId).toBe(bob);
    expect(real.title).toBe("Engineer");

    const virtual = await addMember(db, project.id, { roleId, displayName: "Field Worker" });
    expect(virtual.userId).toBeNull();
    expect(virtual.displayName).toBe("Field Worker");

    const members = await listMembers(db, project.id);
    expect(members).toHaveLength(3); // creator + 2
  });

  test("promotes a virtual member to a real user", async () => {
    const creator = await seedUser("Alice");
    const carol = await seedUser("Carol");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);

    const virtual = await addMember(db, project.id, { roleId, displayName: "Ext" });
    const promoted = await updateMember(db, project.id, virtual.id, { userId: carol });
    expect(promoted?.userId).toBe(carol);
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

describe("updateProject", () => {
  test("bumps version and applies the patch", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const updated = await updateProject(db, project.shortId, { name: "P2", status: "archived" });
    expect(updated?.name).toBe("P2");
    expect(updated?.status).toBe("archived");
    expect(updated!.version).toBe(2);
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
});

describe("listProjects", () => {
  test("paginates, filters by status, excludes soft-deleted", async () => {
    const creator = await seedUser("Alice");
    await createProject(db, { name: "A", status: "active", creatorId: creator });
    await createProject(db, { name: "B", status: "archived", creatorId: creator });
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
    await createProject(db, { name: "Live", status: "active", creatorId: creator });
    await createProject(db, { name: "Old", status: "archived", creatorId: creator });

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
    const byTag = await listProjects(db, { tagId: tag.id });
    expect(byTag.total).toBe(1);
    expect(byTag.data[0]!.name).toBe("Tagged");
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

    // Baseline Member role has no capabilities.
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    // A custom role granting procurement visibility.
    const viewer = await createRole(db, project.id, { name: "Procurement Viewer", capabilities: ["procurement.view"] });
    await addMember(db, project.id, { roleId: viewer.id, userId: carol });

    expect((await getMemberCapabilities(db, project.id, creator))?.has("project.manage")).toBe(true);
    expect(await hasCapability(db, project.id, bob, "procurement.view")).toBe(false);
    expect(await hasCapability(db, project.id, carol, "procurement.view")).toBe(true);
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

describe("global procurement categories", () => {
  test("CRUD over the global template set", async () => {
    const created = await createGlobalCategory(db, { name: "Hull", code: "HUL" });
    expect(created.name).toBe("Hull");
    expect((await listGlobalCategories(db)).map(c => c.name)).toEqual(["Hull"]);

    const updated = await updateGlobalCategory(db, created.id, { name: "Hull & deck" });
    expect(updated?.name).toBe("Hull & deck");
    expect(await updateGlobalCategory(db, "missing", { name: "X" })).toBeUndefined();

    expect(await deleteGlobalCategory(db, created.id)).toBe(true);
    expect(await deleteGlobalCategory(db, created.id)).toBe(false);
    expect(await listGlobalCategories(db)).toHaveLength(0);
  });

  test("a new project is seeded from the current global set (copy-on-create)", async () => {
    const creator = await seedUser("Alice");
    await createGlobalCategory(db, { name: "Engine", code: "ENG" });
    await createGlobalCategory(db, { name: "Safety" });

    const project = await createProject(db, { name: "P", creatorId: creator });
    const seeded = await listCategories(db, project.id);
    expect(seeded.map(c => c.name).sort()).toEqual(["Engine", "Safety"]);
  });

  test("a project created with no globals defined gets none", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    expect(await listCategories(db, project.id)).toHaveLength(0);
  });

  test("later global edits do not touch existing projects", async () => {
    const creator = await seedUser("Alice");
    const cat = await createGlobalCategory(db, { name: "Original" });
    const project = await createProject(db, { name: "P", creatorId: creator });

    // Mutate the global set after the project exists.
    await updateGlobalCategory(db, cat.id, { name: "Renamed" });
    await createGlobalCategory(db, { name: "Added later" });
    await deleteGlobalCategory(db, cat.id);

    const seeded = await listCategories(db, project.id);
    // The project keeps its original copy, unaffected by global churn.
    expect(seeded.map(c => c.name)).toEqual(["Original"]);
  });
});

describe("project defaults on create", () => {
  test("applies the default status when the payload omits it", async () => {
    const creator = await seedUser("Alice");
    await setSetting(db, "project.defaults.status", "archived");

    const defaulted = await createProject(db, { name: "Defaulted", creatorId: creator });
    expect(defaulted.status).toBe("archived");

    // An explicit status in the payload overrides the default.
    const explicit = await createProject(db, { name: "Explicit", status: "active", creatorId: creator });
    expect(explicit.status).toBe("active");
  });

  test("falls back to active when the default status is unset or invalid", async () => {
    const creator = await seedUser("Alice");
    const none = await createProject(db, { name: "None", creatorId: creator });
    expect(none.status).toBe("active");

    await setSetting(db, "project.defaults.status", "bogus");
    const invalid = await createProject(db, { name: "Invalid", creatorId: creator });
    expect(invalid.status).toBe("active");
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
