import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import {
  acquireEditLock,
  EDIT_LOCK_TTL_MS,
  EditLockConflictError,
  heartbeatEditLock,
  isLockExpired,
  releaseEditLock,
  updateEntryLiveContent,
} from "./drive.edit-lock.service";
import { uploadDriveFile } from "./drive.service";
import { driveEntries, driveFileVersions } from "./schema";

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

function textFile(name: string, body = "v1"): File {
  return new File([body], name, { type: "text/plain" });
}

function personal(userId: string) {
  return { ownerType: "user" as const, ownerId: userId };
}

/** Seed a `file` drive entry and return its id along with the owner's userId. */
async function seedFileEntry() {
  const userId = await seedUser();
  const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
  return { userId, entryId: entry.id };
}

async function rowOf(id: string) {
  return (await db.select().from(driveEntries).where(eq(driveEntries.id, id)).get())!;
}

async function versionCount(entryId: string) {
  return (await db.select({ value: count() }).from(driveFileVersions).where(eq(driveFileVersions.driveEntryId, entryId)).get())!.value;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-editlock-${Date.now()}-${nanoid()}`);
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

describe("isLockExpired", () => {
  test("null lock-time is always expired", () => {
    expect(isLockExpired(null, 1000)).toBe(true);
  });

  test("within the TTL window is fresh, beyond it is expired", () => {
    expect(isLockExpired(1000, 1000 + EDIT_LOCK_TTL_MS)).toBe(false);
    expect(isLockExpired(1000, 1000 + EDIT_LOCK_TTL_MS + 1)).toBe(true);
  });
});

describe("acquireEditLock", () => {
  test("acquiring on a free entry sets the lock", async () => {
    const { userId, entryId } = await seedFileEntry();
    const result = await acquireEditLock(db, entryId, "edit-1", userId, 1000);

    expect(result).toMatchObject({ editId: "edit-1", lockBy: userId, lockAt: 1000, takenOver: false });
    const row = await rowOf(entryId);
    expect(row.editLockId).toBe("edit-1");
    expect(row.editLockBy).toBe(userId);
    expect(row.editLockAt).toBe(1000);
  });

  test("a second editId on a fresh lock throws EditLockConflictError with the holder's userId", async () => {
    const { userId, entryId } = await seedFileEntry();
    const other = await seedUser("Bob");
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);

    const promise = acquireEditLock(db, entryId, "edit-2", other, 1000 + EDIT_LOCK_TTL_MS);
    await expect(promise).rejects.toBeInstanceOf(EditLockConflictError);
    await expect(promise).rejects.toMatchObject({ statusCode: 409, code: "DRIVE_EDIT_LOCKED", lockBy: userId });

    // The original holder's lock is untouched.
    const row = await rowOf(entryId);
    expect(row.editLockId).toBe("edit-1");
  });

  test("a second editId after TTL expiry succeeds and reports takenOver", async () => {
    const { userId, entryId } = await seedFileEntry();
    const other = await seedUser("Bob");
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);

    const result = await acquireEditLock(db, entryId, "edit-2", other, 1000 + EDIT_LOCK_TTL_MS + 1);
    expect(result.takenOver).toBe(true);
    expect(result.editId).toBe("edit-2");

    const row = await rowOf(entryId);
    expect(row.editLockId).toBe("edit-2");
    expect(row.editLockBy).toBe(other);
  });

  test("re-acquiring with the same editId is not a takeover", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);
    const result = await acquireEditLock(db, entryId, "edit-1", userId, 2000);
    expect(result.takenOver).toBe(false);
    expect((await rowOf(entryId)).editLockAt).toBe(2000);
  });
});

describe("heartbeatEditLock", () => {
  test("matching editId on a fresh lock renews editLockAt", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);

    const result = await heartbeatEditLock(db, entryId, "edit-1", 1000 + EDIT_LOCK_TTL_MS);
    expect(result.lockAt).toBe(1000 + EDIT_LOCK_TTL_MS);
    expect((await rowOf(entryId)).editLockAt).toBe(1000 + EDIT_LOCK_TTL_MS);
  });

  test("mismatched editId throws 409 DRIVE_EDIT_LOCK_STALE", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);
    await expect(heartbeatEditLock(db, entryId, "edit-2", 1500)).rejects.toMatchObject({ statusCode: 409, code: "DRIVE_EDIT_LOCK_STALE" });
  });

  test("an expired lock throws 409 even for the original holder", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);
    await expect(heartbeatEditLock(db, entryId, "edit-1", 1000 + EDIT_LOCK_TTL_MS + 1)).rejects.toMatchObject({ statusCode: 409, code: "DRIVE_EDIT_LOCK_STALE" });
  });
});

describe("releaseEditLock", () => {
  test("the holder clears the lock", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);

    const result = await releaseEditLock(db, entryId, "edit-1");
    expect(result.released).toBe(true);
    const row = await rowOf(entryId);
    expect(row.editLockId).toBeNull();
    expect(row.editLockBy).toBeNull();
    expect(row.editLockAt).toBeNull();
  });

  test("a non-holder is a no-op and leaves the lock unchanged", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);

    const result = await releaseEditLock(db, entryId, "edit-2");
    expect(result.released).toBe(false);
    const row = await rowOf(entryId);
    expect(row.editLockId).toBe("edit-1");
    expect(row.editLockBy).toBe(userId);
    expect(row.editLockAt).toBe(1000);
  });
});

describe("updateEntryLiveContent", () => {
  test("a valid lock sets currentContentBody without adding a version", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);
    const before = await versionCount(entryId);

    const result = await updateEntryLiveContent(db, entryId, "edit-1", "live body", 1500);
    expect(result.id).toBe(entryId);

    const row = await rowOf(entryId);
    expect(row.currentContentBody).toBe("live body");
    // Heartbeat renewed as a side effect.
    expect(row.editLockAt).toBe(1500);
    // No new drive_file_versions row was created.
    expect(await versionCount(entryId)).toBe(before);
  });

  test("a stale editId throws 409", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);
    await expect(updateEntryLiveContent(db, entryId, "edit-2", "x", 1500)).rejects.toMatchObject({ statusCode: 409, code: "DRIVE_EDIT_LOCK_STALE" });
  });

  test("an expired lock throws 409", async () => {
    const { userId, entryId } = await seedFileEntry();
    await acquireEditLock(db, entryId, "edit-1", userId, 1000);
    await expect(updateEntryLiveContent(db, entryId, "edit-1", "x", 1000 + EDIT_LOCK_TTL_MS + 1)).rejects.toMatchObject({ statusCode: 409, code: "DRIVE_EDIT_LOCK_STALE" });
  });
});
