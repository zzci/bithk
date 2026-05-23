import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { createShare } from "@/modules/share/share.service";
import { assertEntryCapability, resolveEntryCapabilities } from "./drive.permission";
import { createDriveFolder, uploadDriveFile } from "./drive.service";
import { addTeamMember, createTeamDirectory } from "./drive.team-directory.service";
import { driveEntries } from "./schema";
// Side-effect import: registers the drive share adapter so `createShare` can
// resolve `drive_entry` resources.
import "./drive.share-adapter";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

const config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS"> = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_ATTACHMENTS_PER_RESOURCE: 20,
  UPLOADS_TOTAL_BYTES: 0,
  FILE_GC_MODE: "sync",
  FILE_PRESIGN_ENABLED: false,
  FILE_PRESIGN_TTL_SECONDS: 300,
};

async function seedUser(name: string, role: "admin" | "user" = "user") {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

function textFile(name: string, body = "hello"): File {
  return new File([body], name, { type: "text/plain" });
}

async function entryRow(id: string) {
  return db.select().from(driveEntries).where(eq(driveEntries.id, id)).get();
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-perm-${Date.now()}-${nanoid()}`);
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

describe("resolveEntryCapabilities — global admin and ownership", () => {
  test("a global admin actor holds every capability", async () => {
    const owner = await seedUser("Owner");
    const admin = await seedUser("Admin", "admin");
    const folder = await createDriveFolder(db, { ownerType: "user", ownerId: owner, createdBy: owner, name: "F" });
    const row = (await entryRow(folder.id))!;
    const caps = await resolveEntryCapabilities(db, row, { id: admin, role: "admin" });
    expect([...caps].sort()).toEqual(["delete", "download", "read", "share", "update"]);
  });

  test("the personal owner holds every capability", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ownerType: "user", ownerId: owner, createdBy: owner, name: "F" });
    const row = (await entryRow(folder.id))!;
    const caps = await resolveEntryCapabilities(db, row, { id: owner, role: "user" });
    expect(caps.has("delete")).toBe(true);
    expect(caps.has("share")).toBe(true);
  });

  test("a stranger with no grant holds nothing", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const folder = await createDriveFolder(db, { ownerType: "user", ownerId: owner, createdBy: owner, name: "F" });
    const row = (await entryRow(folder.id))!;
    const caps = await resolveEntryCapabilities(db, row, { id: stranger, role: "user" });
    expect(caps.size).toBe(0);
  });
});

describe("resolveEntryCapabilities — team directory roles", () => {
  async function dirEntry(role: "admin" | "editor" | "viewer" | "none") {
    const creator = await seedUser("Creator");
    const member = await seedUser("Member");
    const dir = await createTeamDirectory(db, { name: `dir-${nanoid()}`, createdBy: creator });
    if (role !== "none")
      await addTeamMember(db, dir.id, creator, { userId: member, role: role === "admin" ? "admin" : role });
    const folder = await createDriveFolder(db, { ownerType: "team_directory", ownerId: dir.id, createdBy: creator, name: "shared" });
    const row = (await entryRow(folder.id))!;
    return { row, member };
  }

  test("team admin gets the full set", async () => {
    const { row, member } = await dirEntry("admin");
    const caps = await resolveEntryCapabilities(db, row, { id: member, role: "user" });
    expect(caps.has("delete")).toBe(true);
    expect(caps.has("share")).toBe(true);
  });

  test("team editor gets the full set", async () => {
    const { row, member } = await dirEntry("editor");
    const caps = await resolveEntryCapabilities(db, row, { id: member, role: "user" });
    expect(caps.has("update")).toBe(true);
    expect(caps.has("delete")).toBe(true);
  });

  test("team viewer gets read + download only", async () => {
    const { row, member } = await dirEntry("viewer");
    const caps = await resolveEntryCapabilities(db, row, { id: member, role: "user" });
    expect([...caps].sort()).toEqual(["download", "read"]);
  });

  test("a non-member of the directory gets nothing", async () => {
    const { row, member } = await dirEntry("none");
    const caps = await resolveEntryCapabilities(db, row, { id: member, role: "user" });
    expect(caps.size).toBe(0);
  });
});

describe("resolveEntryCapabilities — project roles", () => {
  async function projectEntry(role: "pm" | "member" | "none") {
    const creator = await seedUser("Creator");
    const actor = await seedUser("Actor");
    const project = await createProject(db, { name: `proj-${nanoid()}`, creatorId: creator });
    if (role !== "none") {
      const roles = await listRoles(db, project.id);
      const roleId = roles.find(r => r.name === (role === "pm" ? "Project Manager" : "Member"))!.id;
      await addMember(db, project.id, { roleId, userId: actor });
    }
    const folder = await createDriveFolder(db, { ownerType: "project", ownerId: project.id, createdBy: creator, name: "files" });
    const row = (await entryRow(folder.id))!;
    return { row, actor };
  }

  test("project pm gets the full set", async () => {
    const { row, actor } = await projectEntry("pm");
    const caps = await resolveEntryCapabilities(db, row, { id: actor, role: "user" });
    expect([...caps].sort()).toEqual(["delete", "download", "read", "share", "update"]);
  });

  test("project internal member gets editor-equivalent (full) caps", async () => {
    const { row, actor } = await projectEntry("member");
    const caps = await resolveEntryCapabilities(db, row, { id: actor, role: "user" });
    expect(caps.has("update")).toBe(true);
    expect(caps.has("delete")).toBe(true);
  });

  test("a non-member gets nothing (fail-closed)", async () => {
    const { row, actor } = await projectEntry("none");
    const caps = await resolveEntryCapabilities(db, row, { id: actor, role: "user" });
    expect(caps.size).toBe(0);
  });
});

describe("resolveEntryCapabilities — additive direct shares", () => {
  async function sharedFile(permission: "view" | "download" | "edit") {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const file = await uploadDriveFile(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, file: textFile("doc.txt") });
    const row = (await entryRow(file.id))!;
    await createShare(db, { resourceType: "drive_entry", resourceId: row.id, createdBy: owner, shareType: "direct", permission, sharedWithUserId: recipient });
    return { row, recipient };
  }

  test("view share → read + download, never delete or share", async () => {
    const { row, recipient } = await sharedFile("view");
    const caps = await resolveEntryCapabilities(db, row, { id: recipient, role: "user" });
    expect([...caps].sort()).toEqual(["download", "read"]);
  });

  test("download share → read + download", async () => {
    const { row, recipient } = await sharedFile("download");
    const caps = await resolveEntryCapabilities(db, row, { id: recipient, role: "user" });
    expect([...caps].sort()).toEqual(["download", "read"]);
  });

  test("edit share → read + download + update, never delete or share", async () => {
    const { row, recipient } = await sharedFile("edit");
    const caps = await resolveEntryCapabilities(db, row, { id: recipient, role: "user" });
    expect([...caps].sort()).toEqual(["download", "read", "update"]);
    expect(caps.has("delete")).toBe(false);
    expect(caps.has("share")).toBe(false);
  });
});

describe("assertEntryCapability", () => {
  test("returns the row when the capability is present", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, file: textFile("a.txt") });
    const row = await assertEntryCapability(db, { id: owner, role: "user" }, file.id, "read");
    expect(row.id).toBe(file.id);
  });

  test("throws NotFound for a missing entry", async () => {
    const owner = await seedUser("Owner");
    await expect(assertEntryCapability(db, { id: owner, role: "user" }, "missingid", "read")).rejects.toMatchObject({ statusCode: 404 });
  });

  test("throws Forbidden when the capability is absent", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const file = await uploadDriveFile(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, file: textFile("a.txt") });
    await expect(assertEntryCapability(db, { id: stranger, role: "user" }, file.id, "read")).rejects.toMatchObject({ statusCode: 403 });
  });
});
