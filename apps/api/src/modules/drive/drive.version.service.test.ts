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
import { fileReferences, files } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { buildDriveEntryDownloadResponse, createDriveFolder, deleteDriveEntryPermanently, uploadDriveFile } from "./drive.service";
import { clearDisplayVersion, listEntryVersions, overwriteEntryVersion, setDisplayVersion, uploadEntryVersion } from "./drive.version.service";
import { driveEntries } from "./schema";

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

async function rowOf(id: string) {
  return (await db.select().from(driveEntries).where(eq(driveEntries.id, id)).get())!;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-version-${Date.now()}-${nanoid()}`);
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

describe("listEntryVersions", () => {
  test("a freshly uploaded file has a single current v1", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    const versions = await listEntryVersions(db, await rowOf(entry.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.versionNo).toBe(1);
    expect(versions[0]!.isCurrent).toBe(true);
  });

  test("rejects listing versions of a folder", async () => {
    const userId = await seedUser();
    const folder = await createDriveFolder(db, { ...personal(userId), createdBy: userId, name: "F" });
    await expect(listEntryVersions(db, await rowOf(folder.id))).rejects.toMatchObject({ code: "INVALID_ENTRY_TYPE" });
  });
});

describe("uploadEntryVersion", () => {
  test("creates a ULID version and advances the display pointer when unpinned", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    const versions = await uploadEntryVersion(db, config, {
      entry: await rowOf(entry.id),
      file: textFile("doc.txt", "second body"),
      uploadedBy: userId,
    });

    // Newest first; ascending display labels.
    expect(versions.map(v => v.versionNo)).toEqual([2, 1]);
    expect(versions[0]!.isCurrent).toBe(true);
    expect(versions[1]!.isCurrent).toBe(false);
    // ULID ids are time-sortable: the newest sorts highest.
    expect(versions[0]!.id > versions[1]!.id).toBe(true);

    // The entry stays unpinned and its display now serves the newest bytes.
    const refreshed = await rowOf(entry.id);
    expect(refreshed.displayVersionId).toBeNull();
    const res = await buildDriveEntryDownloadResponse(db, config, personal(userId), entry.id, false);
    expect(await res.text()).toBe("second body");
  });

  test("a pinned entry keeps its display pointer when a new version arrives", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    const afterUpload = await uploadEntryVersion(db, config, {
      entry: await rowOf(entry.id),
      file: textFile("doc.txt", "second"),
      uploadedBy: userId,
    });
    const v1 = afterUpload.find(v => v.versionNo === 1)!;

    // Pin the older version, then upload a third version.
    await setDisplayVersion(db, await rowOf(entry.id), v1.id);
    await uploadEntryVersion(db, config, { entry: await rowOf(entry.id), file: textFile("doc.txt", "third"), uploadedBy: userId });

    // Display stays pinned on v1's bytes even though newer versions exist.
    const refreshed = await rowOf(entry.id);
    expect(refreshed.displayVersionId).toBe(v1.id);
    const res = await buildDriveEntryDownloadResponse(db, config, personal(userId), entry.id, false);
    expect(await res.text()).toBe("first");
  });
});

describe("setDisplayVersion / clearDisplayVersion", () => {
  test("pinning an older version makes content GET serve it; clearing returns to latest", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    const afterUpload = await uploadEntryVersion(db, config, {
      entry: await rowOf(entry.id),
      file: textFile("doc.txt", "second"),
      uploadedBy: userId,
    });
    const v1 = afterUpload.find(v => v.versionNo === 1)!;

    const pinned = await setDisplayVersion(db, await rowOf(entry.id), v1.id);
    expect(pinned.find(v => v.isCurrent)!.versionNo).toBe(1);
    expect((await rowOf(entry.id)).displayVersionId).toBe(v1.id);
    const pinnedRes = await buildDriveEntryDownloadResponse(db, config, personal(userId), entry.id, false);
    expect(await pinnedRes.text()).toBe("first");

    const cleared = await clearDisplayVersion(db, await rowOf(entry.id));
    expect(cleared.find(v => v.isCurrent)!.versionNo).toBe(2);
    expect((await rowOf(entry.id)).displayVersionId).toBeNull();
    const clearedRes = await buildDriveEntryDownloadResponse(db, config, personal(userId), entry.id, false);
    expect(await clearedRes.text()).toBe("second");
  });

  test("rejects an unknown version id", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt") });
    await expect(setDisplayVersion(db, await rowOf(entry.id), "nope")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("overwriteEntryVersion", () => {
  test("replaces a version's content in place — no new version row, old blob released, display follows", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    // First autosave of a session creates the session version (v2).
    const created = await uploadEntryVersion(db, config, { entry: await rowOf(entry.id), file: textFile("doc.txt", "draft-a"), uploadedBy: userId });
    const sessionId = created[0]!.id; // newest by ULID
    expect(created).toHaveLength(2);
    expect((await db.select({ value: count() }).from(files).get())?.value).toBe(2); // first + draft-a

    // Later saves overwrite the same version instead of appending.
    const afterOverwrite = await overwriteEntryVersion(db, config, {
      entry: await rowOf(entry.id),
      versionId: sessionId,
      file: textFile("doc.txt", "draft-b"),
      uploadedBy: userId,
    });
    expect(afterOverwrite).toHaveLength(2); // still two versions — coalesced
    // The old draft-a blob is released, so blobs did not accrue.
    expect((await db.select({ value: count() }).from(files).get())?.value).toBe(2); // first + draft-b

    const res = await buildDriveEntryDownloadResponse(db, config, personal(userId), entry.id, false);
    expect(await res.text()).toBe("draft-b");
  });

  test("does not move the display when the entry shows a different version", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    const created = await uploadEntryVersion(db, config, { entry: await rowOf(entry.id), file: textFile("doc.txt", "second"), uploadedBy: userId });
    const v1 = created.find(v => v.versionNo === 1)!;
    const v2 = created.find(v => v.versionNo === 2)!;

    // Pin the display to v1, then overwrite the (non-displayed) v2.
    await setDisplayVersion(db, await rowOf(entry.id), v1.id);
    await overwriteEntryVersion(db, config, { entry: await rowOf(entry.id), versionId: v2.id, file: textFile("doc.txt", "second-edited"), uploadedBy: userId });

    // Display stays on v1's bytes.
    expect((await rowOf(entry.id)).displayVersionId).toBe(v1.id);
    const res = await buildDriveEntryDownloadResponse(db, config, personal(userId), entry.id, false);
    expect(await res.text()).toBe("first");
  });

  test("rejects an unknown version id", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt") });
    await expect(overwriteEntryVersion(db, config, {
      entry: await rowOf(entry.id),
      versionId: "nope",
      file: textFile("doc.txt", "x"),
      uploadedBy: userId,
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("permanent delete releases every version reference exactly once", () => {
  test("all blobs/references are gone after purging a multi-version entry", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: textFile("doc.txt", "first") });
    await uploadEntryVersion(db, config, { entry: await rowOf(entry.id), file: textFile("doc.txt", "second"), uploadedBy: userId });
    await uploadEntryVersion(db, config, { entry: await rowOf(entry.id), file: textFile("doc.txt", "third"), uploadedBy: userId });

    // Three distinct version blobs exist before delete.
    const filesBefore = await db.select({ value: count() }).from(files).get();
    expect(filesBefore?.value).toBe(3);

    await deleteDriveEntryPermanently(db, config, personal(userId), entry.id);

    const refCount = await db.select({ value: count() }).from(fileReferences).get();
    const fileCount = await db.select({ value: count() }).from(files).get();
    expect(refCount?.value).toBe(0);
    expect(fileCount?.value).toBe(0);
  });
});
