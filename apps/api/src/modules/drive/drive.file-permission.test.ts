import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { FilePermissionHook } from "@/modules/file";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { getFilePermissionHook } from "@/modules/file/permission";
import { fileReferences } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { createShare } from "@/modules/share/share.service";
import { uploadDriveFile } from "./drive.service";
import { addTeamMember, createTeamDirectory } from "./drive.team-directory.service";
// Side-effect imports: register the `drive_entry` file-permission hook (the
// subject under test) and the drive share adapter (so `createShare` resolves
// `drive_entry` resources).
import "./drive.file-permission";
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

/** The registered drive_entry hook — fail loudly if the side-effect import broke. */
function driveHook(): FilePermissionHook {
  const hook = getFilePermissionHook("drive_entry");
  if (!hook)
    throw new Error("drive_entry file-permission hook is not registered");
  return hook;
}

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

/**
 * Upload a drive file under `(ownerType, ownerId)` and return its
 * `file_references` row — exactly what the `/files` routes hand the hook.
 */
async function driveFileRef(ownerType: "user" | "team_directory" | "project", ownerId: string, createdBy: string) {
  const entry = await uploadDriveFile(db, config, { ownerType, ownerId, createdBy, file: textFile("doc.txt") });
  const ref = await db
    .select()
    .from(fileReferences)
    .where(and(eq(fileReferences.ownerType, "drive_entry"), eq(fileReferences.ownerId, entry.id)))
    .get();
  return ref!;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-fileperm-${Date.now()}-${nanoid()}`);
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

describe("drive_entry hook — personal ownership", () => {
  test("the owner can read and delete", async () => {
    const owner = await seedUser("Owner");
    const ref = await driveFileRef("user", owner, owner);
    const actor = { id: owner, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(true);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(true);
  });

  test("a stranger can neither read nor delete (was the bug: owner-only check)", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const ref = await driveFileRef("user", owner, owner);
    const actor = { id: stranger, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(false);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(false);
  });

  test("a global admin can read and delete any entry", async () => {
    const owner = await seedUser("Owner");
    const admin = await seedUser("Admin", "admin");
    const ref = await driveFileRef("user", owner, owner);
    const actor = { id: admin, role: "admin" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(true);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(true);
  });

  test("returns false when the referenced entry no longer exists", async () => {
    const owner = await seedUser("Owner");
    const ref = await driveFileRef("user", owner, owner);
    const missingRef = { ...ref, ownerId: "no-such-entry" };
    const actor = { id: owner, role: "user" };
    expect(await driveHook().canRead(db, actor, missingRef)).toBe(false);
    expect(await driveHook().canDelete(db, actor, missingRef)).toBe(false);
  });
});

describe("drive_entry hook — team directory access", () => {
  async function teamRef(role: "admin" | "editor" | "viewer" | "none") {
    const creator = await seedUser("Creator");
    const member = await seedUser("Member");
    const dir = await createTeamDirectory(db, { name: `dir-${nanoid()}`, createdBy: creator });
    if (role !== "none")
      await addTeamMember(db, dir.id, creator, { userId: member, role });
    const ref = await driveFileRef("team_directory", dir.id, creator);
    return { ref, member };
  }

  test("team editor can read and delete (denied before the fix)", async () => {
    const { ref, member } = await teamRef("editor");
    const actor = { id: member, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(true);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(true);
  });

  test("team viewer can read but not delete", async () => {
    const { ref, member } = await teamRef("viewer");
    const actor = { id: member, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(true);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(false);
  });

  test("a non-member can neither read nor delete", async () => {
    const { ref, member } = await teamRef("none");
    const actor = { id: member, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(false);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(false);
  });
});

describe("drive_entry hook — project access", () => {
  type ProjectRole = "pm" | "reader" | "guest" | "none";

  async function projectRef(role: ProjectRole) {
    const creator = await seedUser("Creator");
    const actor = await seedUser("Actor");
    const project = await createProject(db, { name: `proj-${nanoid()}`, creatorId: creator });
    if (role !== "none") {
      const roles = await listRoles(db, project.id);
      const roleName = role === "pm" ? "Project Owner" : role === "reader" ? "Reader" : "Guest";
      const roleId = roles.find(r => r.name === roleName)!.id;
      await addMember(db, project.id, { roleId, userId: actor });
    }
    const ref = await driveFileRef("project", project.id, creator);
    return { ref, actor };
  }

  test("a project manager (files.manage) can read and delete", async () => {
    const { ref, actor } = await projectRef("pm");
    const who = { id: actor, role: "user" };
    expect(await driveHook().canRead(db, who, ref)).toBe(true);
    expect(await driveHook().canDelete(db, who, ref)).toBe(true);
  });

  test("a project reader (files.view) can read but not delete", async () => {
    const { ref, actor } = await projectRef("reader");
    const who = { id: actor, role: "user" };
    expect(await driveHook().canRead(db, who, ref)).toBe(true);
    expect(await driveHook().canDelete(db, who, ref)).toBe(false);
  });

  test("a non-member can neither read nor delete", async () => {
    const { ref, actor } = await projectRef("none");
    const who = { id: actor, role: "user" };
    expect(await driveHook().canRead(db, who, ref)).toBe(false);
    expect(await driveHook().canDelete(db, who, ref)).toBe(false);
  });
});

describe("drive_entry hook — direct shares", () => {
  async function sharedRef(permission: "view" | "edit") {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const ref = await driveFileRef("user", owner, owner);
    await createShare(db, {
      resourceType: "drive_entry",
      resourceId: ref.ownerId,
      createdBy: owner,
      shareType: "direct",
      permission,
      sharedWithUserId: recipient,
    });
    return { ref, recipient };
  }

  test("a view share confers read but never delete", async () => {
    const { ref, recipient } = await sharedRef("view");
    const actor = { id: recipient, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(true);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(false);
  });

  test("an edit share confers read but still never delete", async () => {
    const { ref, recipient } = await sharedRef("edit");
    const actor = { id: recipient, role: "user" };
    expect(await driveHook().canRead(db, actor, ref)).toBe(true);
    expect(await driveHook().canDelete(db, actor, ref)).toBe(false);
  });
});
