import type { FileStorageDriver } from "./storage/types";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import {
  createDriveSpreadsheet,
  createDriveTextFile,
  uploadDriveFile,
} from "@/modules/drive/drive.service";
import { UNIVER_SHEET_MIME } from "@/modules/drive/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { settings } from "@/modules/settings/schema";
import { ulidTimeMs } from "@/shared/lib/id";
import { buildDownloadResponse, uploadAndReference } from "./file.service";
import { fileBlobs, fileReferences, files } from "./schema";
import { readStorageConfig, STORAGE_SETTING_KEYS } from "./storage-config";
import { listStorageFiles, syncNonSpreadsheetsToS3, syncSpreadsheetsToDb } from "./storage.service";
import { dbDriver, setDbDriverDatabase } from "./storage/db";
import { __setLocalDriverRootForTests } from "./storage/local";
import { __resetDriverRegistryForTests, getDriver, registerDriver, setActiveDriver, setActiveUploadDriver } from "./storage/registry";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const config = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_ATTACHMENTS_PER_RESOURCE: 20,
  UPLOADS_TOTAL_BYTES: 0,
  FILE_GC_MODE: "sync" as const,
  FILE_PRESIGN_ENABLED: false,
  FILE_PRESIGN_TTL_SECONDS: 300,
};
const syncConfig = { FILE_GC_MODE: "sync" as const, FILE_PRESIGN_ENABLED: false, FILE_PRESIGN_TTL_SECONDS: 300 };

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

function personal(userId: string) {
  return { ownerType: "user" as const, ownerId: userId };
}

// In-memory fake S3 driver so multi-driver + sync can be exercised offline.
const s3Store = new Map<string, Uint8Array>();
function makeFakeS3(): FileStorageDriver {
  return {
    name: "s3",
    async put(key, data) {
      s3Store.set(key, new Uint8Array(data as ArrayBuffer));
    },
    async getStream(key) {
      const bytes = s3Store.get(key);
      if (!bytes)
        throw new Error(`missing ${key}`);
      return new ReadableStream({ start(c) {
        c.enqueue(bytes);
        c.close();
      } });
    },
    async delete(key) {
      s3Store.delete(key);
    },
    async exists(key) {
      return s3Store.has(key);
    },
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-storage-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  s3Store.clear();
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setDbDriverDatabase(db);
  setActiveDriver("local");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("db storage driver", () => {
  test("put / getStream / delete / exists round-trip", async () => {
    const key = "ab/cd/deadbeef";
    const data = new TextEncoder().encode("hello db driver");
    expect(await dbDriver.exists(key)).toBe(false);
    await dbDriver.put(key, data.buffer);
    expect(await dbDriver.exists(key)).toBe(true);

    const stream = await dbDriver.getStream(key);
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe("hello db driver");

    // The row lives in file_blob.
    const row = await db.select().from(fileBlobs).where(eq(fileBlobs.storageKey, key)).get();
    expect(row).toBeTruthy();

    await dbDriver.delete(key);
    expect(await dbDriver.exists(key)).toBe(false);
    // Deleting a missing key is a no-op.
    await dbDriver.delete(key);
  });

  test("put upserts (same key twice keeps one row, latest bytes)", async () => {
    const key = "aa/bb/cc0011";
    await dbDriver.put(key, new TextEncoder().encode("v1").buffer);
    await dbDriver.put(key, new TextEncoder().encode("v2").buffer);
    const rows = await db.select().from(fileBlobs).where(eq(fileBlobs.storageKey, key)).all();
    expect(rows).toHaveLength(1);
    const stream = await dbDriver.getStream(key);
    expect(await new Response(stream).text()).toBe("v2");
  });

  test("getStream throws for a missing key; stat reports size", async () => {
    await expect(dbDriver.getStream("no/su/chkey")).rejects.toThrow(/Missing blob/);
    await dbDriver.put("11/22/abcdef", new TextEncoder().encode("12345").buffer);
    expect(await dbDriver.stat!("11/22/abcdef")).toEqual({ size: 5 });
    expect(await dbDriver.stat!("no/su/chkey")).toBeNull();
  });
});

describe("created files land in the DB", () => {
  test("createDriveTextFile stores storageDriver=db and serves from file_blob", async () => {
    const userId = await seedUser();
    const entry = await createDriveTextFile(db, config, { ...personal(userId), createdBy: userId, name: "notes.txt", content: "line one" });
    const fileRow = await db.select().from(files).where(eq(files.id, entry.file!.fileId)).get();
    expect(fileRow?.storageDriver).toBe("db");
    // One file_blob row for its bytes.
    expect((await db.select().from(fileBlobs).all()).length).toBe(1);
    // buildDriveEntryDownloadResponse (delegates to buildDownloadResponse) serves it.
    const ref = (await db.select().from(fileReferences).where(eq(fileReferences.id, entry.file!.referenceId)).get())!;
    const res = await buildDownloadResponse(syncConfig, fileRow!, ref, { inline: false });
    expect(await res.text()).toBe("line one");
  });

  test("createDriveSpreadsheet stores storageDriver=db", async () => {
    const userId = await seedUser();
    const snapshot = JSON.stringify({ id: "wb", sheets: {} });
    const entry = await createDriveSpreadsheet(db, config, { ...personal(userId), createdBy: userId, name: "Plan", content: snapshot });
    const fileRow = await db.select().from(files).where(eq(files.id, entry.file!.fileId)).get();
    expect(fileRow?.storageDriver).toBe("db");
    expect(fileRow?.mimetype).toBe(UNIVER_SHEET_MIME);
  });

  test("an uploaded file uses the configured upload driver (local), not db", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: new File(["upload"], "u.txt", { type: "text/plain" }) });
    const fileRow = await db.select().from(files).where(eq(files.id, entry.file!.fileId)).get();
    expect(fileRow?.storageDriver).toBe("local");
    // No file_blob row for an uploaded (local) file.
    expect((await db.select().from(fileBlobs).all()).length).toBe(0);
  });
});

describe("multi-driver serving", () => {
  test("a db file and a local file both serve via their own driver", async () => {
    const userId = await seedUser();
    // Created → db.
    const created = await createDriveTextFile(db, config, { ...personal(userId), createdBy: userId, name: "db.txt", content: "from-db" });
    // Uploaded → local.
    const uploaded = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: new File(["from-local"], "local.txt", { type: "text/plain" }) });

    const dbFile = (await db.select().from(files).where(eq(files.id, created.file!.fileId)).get())!;
    const dbRef = (await db.select().from(fileReferences).where(eq(fileReferences.id, created.file!.referenceId)).get())!;
    const localFile = (await db.select().from(files).where(eq(files.id, uploaded.file!.fileId)).get())!;
    const localRef = (await db.select().from(fileReferences).where(eq(fileReferences.id, uploaded.file!.referenceId)).get())!;

    expect(dbFile.storageDriver).toBe("db");
    expect(localFile.storageDriver).toBe("local");
    expect(await (await buildDownloadResponse(syncConfig, dbFile, dbRef, { inline: false })).text()).toBe("from-db");
    expect(await (await buildDownloadResponse(syncConfig, localFile, localRef, { inline: false })).text()).toBe("from-local");
  });
});

describe("uploadAndReference explicit driver", () => {
  test("driverName targets the chosen driver and dedup is per (sha, driver)", async () => {
    const userId = await seedUser();
    // Same bytes to db and to local — two files rows (dedup is per driver).
    const toDb = await uploadAndReference(db, config, { file: new File(["dup"], "a.txt", { type: "text/plain" }), ownerType: "x", ownerId: "1", uploadedBy: userId, driverName: "db" });
    const toLocal = await uploadAndReference(db, config, { file: new File(["dup"], "b.txt", { type: "text/plain" }), ownerType: "x", ownerId: "2", uploadedBy: userId });
    expect(toDb.file.storageDriver).toBe("db");
    expect(toLocal.file.storageDriver).toBe("local");
    expect(toDb.file.id).not.toBe(toLocal.file.id);
  });
});

describe("sync-to-s3", () => {
  test("moves a non-spreadsheet db file to s3 and deletes the old blob; skips a spreadsheet", async () => {
    const userId = await seedUser();
    registerDriver(makeFakeS3());

    // A created text file (db) and a created spreadsheet (db).
    const text = await createDriveTextFile(db, config, { ...personal(userId), createdBy: userId, name: "t.txt", content: "movable" });
    const sheet = await createDriveSpreadsheet(db, config, { ...personal(userId), createdBy: userId, name: "S", content: "{}" });

    const textFileBefore = (await db.select().from(files).where(eq(files.id, text.file!.fileId)).get())!;
    expect(await getDriver("db").exists(textFileBefore.storageKey)).toBe(true);

    const summary = await syncNonSpreadsheetsToS3(db);
    expect(summary.moved).toBe(1); // the text file
    expect(summary.skipped).toBe(1); // the spreadsheet
    expect(summary.failed).toBe(0);

    // Text file repointed to s3; old db blob deleted; s3 has the bytes.
    const textFileAfter = (await db.select().from(files).where(eq(files.id, text.file!.fileId)).get())!;
    expect(textFileAfter.storageDriver).toBe("s3");
    expect(s3Store.has(textFileAfter.storageKey)).toBe(true);
    expect(await getDriver("db").exists(textFileBefore.storageKey)).toBe(false);
    // The new key buckets by the blob's ORIGINAL upload hour (row-id ULID mint
    // time), not the sync time — so the layout reflects real upload times.
    const d = new Date(ulidTimeMs(textFileAfter.id)!);
    const pad = (n: number): string => String(n).padStart(2, "0");
    const hour = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
    expect(textFileAfter.storageKey).toBe(`${hour}/${textFileAfter.id}`);

    // Spreadsheet still on db.
    const sheetFile = (await db.select().from(files).where(eq(files.id, sheet.file!.fileId)).get())!;
    expect(sheetFile.storageDriver).toBe("db");
  });

  test("dry-run reports movers without touching rows or S3 (FEAT-053)", async () => {
    const userId = await seedUser();
    registerDriver(makeFakeS3());
    const text = await createDriveTextFile(db, config, { ...personal(userId), createdBy: userId, name: "t.txt", content: "movable" });
    const before = (await db.select().from(files).where(eq(files.id, text.file!.fileId)).get())!;

    const summary = await syncNonSpreadsheetsToS3(db, { dryRun: true });
    expect(summary.moved).toBe(1);
    expect(summary.failed).toBe(0);

    const after = (await db.select().from(files).where(eq(files.id, text.file!.fileId)).get())!;
    expect(after.storageDriver).toBe("db");
    expect(after.storageKey).toBe(before.storageKey);
    expect(s3Store.size).toBe(0);
  });

  test("re-keys a legacy ab/cd S3 object in place to the hour layout (FEAT-053)", async () => {
    const userId = await seedUser();
    registerDriver(makeFakeS3());
    // Upload to s3 (canonical key), then rewrite the row + object to a legacy
    // ab/cd/<sha> key to simulate a pre-REFACTOR-038 S3 blob.
    await db.insert(settings).values({ key: STORAGE_SETTING_KEYS.uploadDriver, value: "s3", updatedAt: new Date().toISOString() }).run();
    setActiveUploadDriver("s3");
    const uploaded = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: new File(["legacybytes"], "l.txt", { type: "text/plain" }) });
    const row = (await db.select().from(files).where(eq(files.id, uploaded.file!.fileId)).get())!;
    const legacyKey = `${row.sha256.slice(0, 2)}/${row.sha256.slice(2, 4)}/${row.sha256}`;
    // Move the fake object to the legacy key and repoint the row.
    s3Store.set(legacyKey, s3Store.get(row.storageKey)!);
    s3Store.delete(row.storageKey);
    await db.update(files).set({ storageKey: legacyKey }).where(eq(files.id, row.id)).run();

    const summary = await syncNonSpreadsheetsToS3(db);
    expect(summary.moved).toBe(1);
    expect(summary.failed).toBe(0);

    const after = (await db.select().from(files).where(eq(files.id, row.id)).get())!;
    expect(after.storageDriver).toBe("s3");
    expect(after.storageKey).toMatch(/^\d{10}\/[0-9a-hjkmnp-tv-z]{26}$/);
    expect(s3Store.has(after.storageKey)).toBe(true);
    expect(s3Store.has(legacyKey)).toBe(false);
  });
});

describe("sync-sheets-to-db (FEAT-054)", () => {
  // Relocate a db-driver spreadsheet's bytes onto `local` and repoint the row,
  // simulating a historical spreadsheet that ended up off the db driver.
  async function moveSheetToLocal(fileId: string): Promise<string> {
    const row = (await db.select().from(files).where(eq(files.id, fileId)).get())!;
    const bytes = await new Response(await getDriver("db").getStream(row.storageKey)).arrayBuffer();
    const localKey = `2026070609/${row.id}`;
    await getDriver("local").put(localKey, bytes);
    await getDriver("db").delete(row.storageKey);
    await db.update(files).set({ storageDriver: "local", storageKey: localKey }).where(eq(files.id, fileId)).run();
    return localKey;
  }

  test("moves a local spreadsheet back to the db driver; leaves a non-sheet local file alone", async () => {
    const userId = await seedUser();
    const sheet = await createDriveSpreadsheet(db, config, { ...personal(userId), createdBy: userId, name: "S", content: "{\"a\":1}" });
    const localKey = await moveSheetToLocal(sheet.file!.fileId);
    // A plain local text upload that must NOT be touched by the sheet migration.
    const text = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: new File(["plain"], "t.txt", { type: "text/plain" }) });

    const summary = await syncSpreadsheetsToDb(db);
    expect(summary.moved).toBe(1); // the sheet
    expect(summary.failed).toBe(0);

    const after = (await db.select().from(files).where(eq(files.id, sheet.file!.fileId)).get())!;
    expect(after.storageDriver).toBe("db");
    expect(after.storageKey).toMatch(/^\d{10}\/[0-9a-hjkmnp-tv-z]{26}$/);
    expect(await getDriver("db").exists(after.storageKey)).toBe(true);
    expect(await getDriver("local").exists(localKey)).toBe(false);
    // Its bytes survived the move intact.
    expect(await new Response(await getDriver("db").getStream(after.storageKey)).text()).toBe("{\"a\":1}");

    // The non-sheet local file is untouched.
    const textAfter = (await db.select().from(files).where(eq(files.id, text.file!.fileId)).get())!;
    expect(textAfter.storageDriver).toBe("local");
  });

  test("is idempotent and dry-run touches nothing", async () => {
    const userId = await seedUser();
    const sheet = await createDriveSpreadsheet(db, config, { ...personal(userId), createdBy: userId, name: "S", content: "{}" });
    const localKey = await moveSheetToLocal(sheet.file!.fileId);

    const dry = await syncSpreadsheetsToDb(db, { dryRun: true });
    expect(dry.moved).toBe(1);
    // Nothing moved on dry-run.
    expect((await db.select().from(files).where(eq(files.id, sheet.file!.fileId)).get())!.storageDriver).toBe("local");
    expect(await getDriver("local").exists(localKey)).toBe(true);

    expect((await syncSpreadsheetsToDb(db)).moved).toBe(1);
    // A second real run finds nothing left to move.
    expect((await syncSpreadsheetsToDb(db)).moved).toBe(0);
  });
});

describe("storage file list", () => {
  test("lists files joined to their owning drive entry with pagination meta", async () => {
    const userId = await seedUser("Owner");
    await createDriveTextFile(db, config, { ...personal(userId), createdBy: userId, name: "one.txt", content: "a" });
    await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: new File(["b"], "two.txt", { type: "text/plain" }) });

    const page = await listStorageFiles(db, 1, 10);
    expect(page.total).toBe(2);
    const names = page.data.map(f => f.name).sort();
    expect(names).toEqual(["one.txt", "two.txt"]);
    const drivers = page.data.map(f => f.storageDriver).sort();
    expect(drivers).toEqual(["db", "local"]);
    for (const f of page.data) {
      expect(f.ownerScope).toBe("user");
      expect(f.uploadedByName).toBe("Owner");
    }
  });
});

describe("storage config", () => {
  test("defaults to local when unset", async () => {
    const cfg = await readStorageConfig(db);
    expect(cfg.uploadDriver).toBe("local");
    expect(cfg.s3.secret).toBe("");
  });

  test("applyStorageConfig switches the upload driver and builds S3 from settings", async () => {
    registerDriver(makeFakeS3());
    // configureS3Driver would run inside applyStorageConfig — but the fake S3
    // needs no client, so switch the upload driver directly and verify routing.
    await db.insert(settings).values({ key: STORAGE_SETTING_KEYS.uploadDriver, value: "s3", updatedAt: new Date().toISOString() }).run();
    setActiveUploadDriver("s3");
    const cfg = await readStorageConfig(db);
    expect(cfg.uploadDriver).toBe("s3");

    const userId = await seedUser();
    const uploaded = await uploadDriveFile(db, config, { ...personal(userId), createdBy: userId, file: new File(["s3body"], "s.txt", { type: "text/plain" }) });
    const fileRow = (await db.select().from(files).where(eq(files.id, uploaded.file!.fileId)).get())!;
    expect(fileRow.storageDriver).toBe("s3");
    expect(s3Store.has(fileRow.storageKey)).toBe(true);
  });
});
