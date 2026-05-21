import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createDriveFolder } from "./drive.service";
import {
  addTeamMember,
  createTeamDirectory,
  deleteTeamDirectory,
  getDirectoryRole,
  getTeamDirectory,
  listTeamDirectories,
  listTeamMembers,
  removeTeamMember,
  updateTeamDirectory,
  updateTeamMember,
} from "./drive.team-directory.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(name = "Alice") {
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

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-dir-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("createTeamDirectory", () => {
  test("the creator becomes an implicit admin with an empty member roster", async () => {
    const creator = await seedUser("Creator");
    const dir = await createTeamDirectory(db, { name: "Engineering", description: "team", createdBy: creator });
    expect(dir.role).toBe("admin");
    expect(dir.memberCount).toBe(0);
    expect(dir.createdBy).toBe(creator);
  });

  test("rejects a blank name", async () => {
    const creator = await seedUser("Creator");
    await expect(createTeamDirectory(db, { name: "   ", createdBy: creator })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("getDirectoryRole", () => {
  test("creator → admin, explicit member → their role, stranger → null, missing dir → null", async () => {
    const creator = await seedUser("Creator");
    const member = await seedUser("Member");
    const stranger = await seedUser("Stranger");
    const dir = await createTeamDirectory(db, { name: "D", createdBy: creator });
    await addTeamMember(db, dir.id, creator, { userId: member, role: "editor" });

    expect(await getDirectoryRole(db, dir.id, creator)).toBe("admin");
    expect(await getDirectoryRole(db, dir.id, member)).toBe("editor");
    expect(await getDirectoryRole(db, dir.id, stranger)).toBeNull();
    expect(await getDirectoryRole(db, "missing", creator)).toBeNull();
  });
});

describe("getTeamDirectory", () => {
  test("a member can read it; a stranger is forbidden", async () => {
    const creator = await seedUser("Creator");
    const member = await seedUser("Member");
    const stranger = await seedUser("Stranger");
    const dir = await createTeamDirectory(db, { name: "D", createdBy: creator });
    await addTeamMember(db, dir.id, creator, { userId: member, role: "viewer" });

    const view = await getTeamDirectory(db, dir.id, member);
    expect(view.role).toBe("viewer");
    expect(view.memberCount).toBe(1);
    await expect(getTeamDirectory(db, dir.id, stranger)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("listTeamDirectories", () => {
  test("returns directories the user owns or is a member of, with counts", async () => {
    const me = await seedUser("Me");
    const other = await seedUser("Other");
    const owned = await createTeamDirectory(db, { name: "Owned", createdBy: me });
    const joined = await createTeamDirectory(db, { name: "Joined", createdBy: other });
    await addTeamMember(db, joined.id, other, { userId: me, role: "editor" });
    await createTeamDirectory(db, { name: "Theirs", createdBy: other });

    const list = await listTeamDirectories(db, me);
    const byId = new Map(list.map(d => [d.id, d]));
    expect(byId.get(owned.id)!.role).toBe("admin");
    expect(byId.get(joined.id)!.role).toBe("editor");
    expect(byId.get(joined.id)!.memberCount).toBe(1);
    expect(list.find(d => d.name === "Theirs")).toBeUndefined();
  });
});

describe("updateTeamDirectory", () => {
  test("an admin can rename / re-describe; a viewer cannot", async () => {
    const creator = await seedUser("Creator");
    const viewer = await seedUser("Viewer");
    const dir = await createTeamDirectory(db, { name: "Old", createdBy: creator });
    await addTeamMember(db, dir.id, creator, { userId: viewer, role: "viewer" });

    const updated = await updateTeamDirectory(db, dir.id, creator, { name: "New", description: "desc" });
    expect(updated.name).toBe("New");
    expect(updated.description).toBe("desc");

    await expect(updateTeamDirectory(db, dir.id, viewer, { name: "Hijack" })).rejects.toMatchObject({ statusCode: 403 });
  });

  test("rejects a blank name", async () => {
    const creator = await seedUser("Creator");
    const dir = await createTeamDirectory(db, { name: "Old", createdBy: creator });
    await expect(updateTeamDirectory(db, dir.id, creator, { name: "  " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("deleteTeamDirectory", () => {
  test("only the creator may delete, and only when empty", async () => {
    const creator = await seedUser("Creator");
    const admin = await seedUser("Admin");
    const dir = await createTeamDirectory(db, { name: "D", createdBy: creator });
    await addTeamMember(db, dir.id, creator, { userId: admin, role: "admin" });

    // A non-creator admin still cannot delete.
    await expect(deleteTeamDirectory(db, dir.id, admin)).rejects.toMatchObject({ statusCode: 403 });

    // A directory holding entries cannot be deleted.
    await createDriveFolder(db, { ownerType: "team_directory", ownerId: dir.id, createdBy: creator, name: "stuff" });
    await expect(deleteTeamDirectory(db, dir.id, creator)).rejects.toMatchObject({ code: "DIRECTORY_NOT_EMPTY" });
  });

  test("the creator can delete an empty directory", async () => {
    const creator = await seedUser("Creator");
    const dir = await createTeamDirectory(db, { name: "D", createdBy: creator });
    await deleteTeamDirectory(db, dir.id, creator);
    await expect(getTeamDirectory(db, dir.id, creator)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("members", () => {
  test("add defaults to viewer; admin-only; the creator cannot be re-added; re-adding updates the role", async () => {
    const creator = await seedUser("Creator");
    const member = await seedUser("Member");
    const outsider = await seedUser("Outsider");
    const dir = await createTeamDirectory(db, { name: "D", createdBy: creator });

    const added = await addTeamMember(db, dir.id, creator, { userId: member });
    expect(added.role).toBe("viewer");

    // Re-adding the same user with a new role updates in place (idempotent upsert).
    const upgraded = await addTeamMember(db, dir.id, creator, { userId: member, role: "editor" });
    expect(upgraded.id).toBe(added.id);
    expect(upgraded.role).toBe("editor");

    // The creator is always admin and cannot be added as a member.
    await expect(addTeamMember(db, dir.id, creator, { userId: creator })).rejects.toMatchObject({ statusCode: 409 });

    // A non-admin cannot add members.
    await expect(addTeamMember(db, dir.id, outsider, { userId: outsider })).rejects.toMatchObject({ statusCode: 403 });
  });

  test("list members is gated to members; updates and removes are admin-only", async () => {
    const creator = await seedUser("Creator");
    const member = await seedUser("Member");
    const stranger = await seedUser("Stranger");
    const dir = await createTeamDirectory(db, { name: "D", createdBy: creator });
    const added = await addTeamMember(db, dir.id, creator, { userId: member, role: "viewer" });

    const list = await listTeamMembers(db, dir.id, member);
    expect(list.map(m => m.userId)).toContain(member);
    await expect(listTeamMembers(db, dir.id, stranger)).rejects.toMatchObject({ statusCode: 403 });

    const updated = await updateTeamMember(db, dir.id, added.id, creator, "editor");
    expect(updated.role).toBe("editor");
    await expect(updateTeamMember(db, dir.id, "ghost", creator, "viewer")).rejects.toMatchObject({ statusCode: 404 });

    await removeTeamMember(db, dir.id, added.id, creator);
    await expect(removeTeamMember(db, dir.id, added.id, creator)).rejects.toMatchObject({ statusCode: 404 });
  });
});
