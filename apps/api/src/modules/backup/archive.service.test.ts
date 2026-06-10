import type { BackupManifestV2 } from "./archive.service";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { extract as tarExtract } from "tar-stream";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { fileBackupContribution } from "@/modules/file/file.backup";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { __setLocalDriverRootForTests, localDriver } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { seedUser, testNanoid } from "@/shared/test/route-harness";
import { ExportCancelledError, writeArchiveV2 } from "./archive.service";
import { streamJsonBackup } from "./export.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let stagingDir: string;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-archive-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  stagingDir = resolve(baseDir, "staging");
  db = await createDb(resolve(baseDir, "test.db"));
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
  registerBackupContribution(fileBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  __resetDriverRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

interface ArchiveEntry { name: string; data: Buffer }

/** Gunzip + untar the staged archive, preserving entry order. */
async function readArchive(path: string): Promise<ArchiveEntry[]> {
  const ex = tarExtract();
  const entries: ArchiveEntry[] = [];
  ex.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (d: Buffer) => chunks.push(d));
    stream.on("end", () => {
      entries.push({ name: header.name, data: Buffer.concat(chunks) });
      next();
    });
  });
  const finished = new Promise<void>((res, rej) => {
    ex.on("finish", res);
    ex.on("error", rej);
  });
  const plain = Bun.file(path).stream().pipeThrough(new DecompressionStream("gzip"));
  for await (const chunk of plain) {
    if (!ex.write(Buffer.from(chunk)))
      await once(ex, "drain");
  }
  ex.end();
  await finished;
  return entries;
}

function parseManifest(entries: ArchiveEntry[]): BackupManifestV2 {
  return JSON.parse(entries[0]!.data.toString("utf8")) as BackupManifestV2;
}

function parseNdjson(entry: ArchiveEntry): Record<string, unknown>[] {
  return entry.data.toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
}

/** Register the local driver against a tmp root and put one blob. */
async function setUpLocalBlob(sha256: string, bytes: Uint8Array): Promise<string> {
  registerDriver(localDriver);
  __setLocalDriverRootForTests(resolve(baseDir, "blob-root"));
  setActiveDriver("local");
  const key = deriveStorageKey(sha256);
  await localDriver.put(key, bytes.buffer as ArrayBuffer);
  return key;
}

async function insertFileRow(id: string, sha256: string, size: number, driver: string, uploadedBy: string): Promise<void> {
  await db.run(sql`
    INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
    VALUES (${id}, ${sha256}, ${size}, 'application/octet-stream', ${driver}, ${deriveStorageKey(sha256)}, 1, ${uploadedBy})
  `);
}

describe("writeArchiveV2 — manifest", () => {
  test("manifest.json is the first entry and describes journal, modules, tables", async () => {
    await seedUser(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('app.theme', 'dark', '2026-01-01T00:00:00Z')`);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["files", "settings"],
      blobsMode: "none",
      stagingDir,
      appName: "app",
    });

    const entries = await readArchive(archivePath);
    expect(entries[0]!.name).toBe("manifest.json");
    const fromArchive = parseManifest(entries);
    expect(fromArchive).toEqual(JSON.parse(JSON.stringify(manifest)) as BackupManifestV2);

    expect(fromArchive.format).toBe("bithk-backup");
    expect(fromArchive.formatVersion).toBe(2);
    expect(fromArchive.redacted).toBe(false);
    expect(fromArchive.blobsMode).toBe("none");
    // Deprecated alias stays consistent with the mode.
    expect(fromArchive.includeBlobs).toBe(false);

    // Journal pins the migration state — compare against the real file.
    const journal = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const last = journal.entries[journal.entries.length - 1]!;
    expect(fromArchive.schema.dialect).toBe("sqlite");
    expect(fromArchive.schema.journal).toEqual({ lastIdx: last.idx, lastTag: last.tag, entryCount: journal.entries.length });

    // `files` depends on `users` → users resolves first (dependency order).
    const moduleNames = fromArchive.modules.map(m => m.name);
    expect(moduleNames.indexOf("users")).toBeLessThan(moduleNames.indexOf("files"));
    expect(fromArchive.modules.find(m => m.name === "files")!.deps).toEqual(["users"]);

    // Table entries: drizzle property names, real PK, FK references.
    const filesTable = fromArchive.tables.find(t => t.name === "files")!;
    expect(filesTable.module).toBe("files");
    expect(filesTable.file).toBe("data/files.ndjson");
    expect(filesTable.primaryKey).toEqual(["id"]);
    const uploadedBy = filesTable.columns.find(c => c.name === "uploadedBy")!;
    expect(uploadedBy).toEqual({ name: "uploadedBy", type: "text", notNull: true, references: "users.id" });
    const refCount = filesTable.columns.find(c => c.name === "refCount")!;
    expect(refCount.hasDefault).toBe(true);

    const usersTable = fromArchive.tables.find(t => t.name === "users")!;
    expect(usersTable.rowCount).toBe(1);
    const settingsTable = fromArchive.tables.find(t => t.name === "settings")!;
    expect(settingsTable.rowCount).toBe(1);
    // `settings` keys by `key`, not `id`.
    expect(settingsTable.primaryKey).toEqual(["key"]);
  });
});

describe("writeArchiveV2 — NDJSON fidelity", () => {
  test("rows are key-for-key identical to the v1 exporter output", async () => {
    await seedUser(db, "admin");
    await seedUser(db, "user");
    await db.run(sql`
      WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 1500)
      INSERT INTO settings (key, value, updated_at) SELECT 'k' || n, 'v' || n, '2026-01-01T00:00:00Z' FROM c
    `);

    const v1 = streamJsonBackup(db, ["users", "settings"]);
    const v1Dump = JSON.parse(await new Response(v1.body).text()) as { tables: Record<string, Record<string, unknown>[]> };

    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["users", "settings"],
      blobsMode: "none",
      stagingDir,
      appName: "app",
    });
    const entries = await readArchive(archivePath);

    const usersRows = parseNdjson(entries.find(e => e.name === "data/users.ndjson")!);
    expect(usersRows).toEqual(v1Dump.tables.users!);
    // 1500 rows spans two keyset batches — pagination parity holds.
    const settingsRows = parseNdjson(entries.find(e => e.name === "data/settings.ndjson")!);
    expect(settingsRows).toEqual(v1Dump.tables.settings!);
  });
});

describe("writeArchiveV2 — blobs", () => {
  test("dedups by sha256, streams bytes, and warns on inactive-driver rows", async () => {
    const userId = await seedUser(db, "admin");
    const shaShared = "ab".repeat(32);
    const shaForeign = "cd".repeat(32);
    const bytes = new Uint8Array(256 * 1024).fill(42);
    await setUpLocalBlob(shaShared, bytes);

    // Two rows share one sha → ONE tar entry. The live schema enforces
    // UNIQUE(sha256, storage_driver), so the second row sits on another
    // driver — its bytes are unreadable here and it is listed in warnings.
    await insertFileRow("f1", shaShared, bytes.length, "local", userId);
    await insertFileRow("f2", shaShared, bytes.length, "s3", userId);
    // A row on an inactive driver → warning, bytes not exported.
    await insertFileRow("f3", shaForeign, 10, "s3", userId);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["files"],
      blobsMode: "embedded",
      stagingDir,
      appName: "app",
    });

    const entries = await readArchive(archivePath);
    const blobEntries = entries.filter(e => e.name.startsWith("blobs/"));
    expect(blobEntries).toHaveLength(1);
    expect(blobEntries[0]!.name).toBe(`blobs/${deriveStorageKey(shaShared)}`);
    expect(blobEntries[0]!.data.equals(Buffer.from(bytes))).toBe(true);

    expect(manifest.blobsMode).toBe("embedded");
    expect(manifest.includeBlobs).toBe(true);
    expect(manifest.blobs).toEqual({ count: 1, totalBytes: bytes.length });
    // expectedBlobs lists EVERY referenced blob, exported or not.
    expect([...manifest.expectedBlobs!].sort((a, b) => a.sha256.localeCompare(b.sha256) || a.storageDriver.localeCompare(b.storageDriver))).toEqual([
      { sha256: shaShared, size: bytes.length, storageKey: deriveStorageKey(shaShared), storageDriver: "local" },
      { sha256: shaShared, size: bytes.length, storageKey: deriveStorageKey(shaShared), storageDriver: "s3" },
      { sha256: shaForeign, size: 10, storageKey: deriveStorageKey(shaForeign), storageDriver: "s3" },
    ].sort((a, b) => a.sha256.localeCompare(b.sha256) || a.storageDriver.localeCompare(b.storageDriver)));
    expect(manifest.warnings).toHaveLength(2);
    expect(manifest.warnings.some(w => w.includes(shaForeign) && w.includes("s3"))).toBe(true);
    expect(manifest.warnings.some(w => w.includes(shaShared) && w.includes("s3"))).toBe(true);
    expect(manifest.tables.find(t => t.name === "files")!.rowCount).toBe(3);
  });

  test("blobsMode:none skips blobs/ entirely but still lists expectedBlobs", async () => {
    const userId = await seedUser(db, "admin");
    const sha = "ab".repeat(32);
    const bytes = new Uint8Array(64).fill(1);
    await setUpLocalBlob(sha, bytes);
    await insertFileRow("f1", sha, bytes.length, "local", userId);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["files"],
      blobsMode: "none",
      stagingDir,
      appName: "app",
    });

    const entries = await readArchive(archivePath);
    expect(entries.some(e => e.name.startsWith("blobs/"))).toBe(false);
    expect(manifest.blobsMode).toBe("none");
    expect(manifest.includeBlobs).toBe(false);
    expect(manifest.blobs).toEqual({ count: 0, totalBytes: 0 });
    expect(manifest.expectedBlobs).toEqual([
      { sha256: sha, size: bytes.length, storageKey: deriveStorageKey(sha), storageDriver: "local" },
    ]);
    // No export attempt → no inactive-driver warnings either.
    expect(manifest.warnings).toEqual([]);
    // Rows still export — restore degrades to v1 row-only semantics.
    expect(parseNdjson(entries.find(e => e.name === "data/files.ndjson")!)).toHaveLength(1);
  });

  test("blobsMode:separate produces a data archive and a blobs-only archive", async () => {
    const userId = await seedUser(db, "admin");
    const shaA = "ab".repeat(32);
    const shaB = "cd".repeat(32);
    const bytesA = new Uint8Array(128 * 1024).fill(7);
    const bytesB = new Uint8Array(64).fill(9);
    await setUpLocalBlob(shaA, bytesA);
    const keyB = deriveStorageKey(shaB);
    await localDriver.put(keyB, bytesB.buffer as ArrayBuffer);
    await insertFileRow("f1", shaA, bytesA.length, "local", userId);
    await insertFileRow("f2", shaB, bytesB.length, "local", userId);

    const result = await writeArchiveV2({
      db,
      modules: ["files"],
      blobsMode: "separate",
      stagingDir,
      appName: "app",
    });

    expect(result.archivePath).toBe(resolve(stagingDir, "archive.tar.gz"));
    expect(result.blobsArchivePath).toBe(resolve(stagingDir, "blobs.tar.gz"));
    expect(result.blobsArchiveSize).toBeGreaterThan(0);
    expect(existsSync(resolve(stagingDir, "blobs.tar.gz.partial"))).toBe(false);

    // Data archive: manifest + NDJSON only, ZERO blobs/ entries.
    const dataEntries = await readArchive(result.archivePath);
    expect(dataEntries[0]!.name).toBe("manifest.json");
    expect(dataEntries.some(e => e.name.startsWith("blobs/"))).toBe(false);
    expect(parseNdjson(dataEntries.find(e => e.name === "data/files.ndjson")!)).toHaveLength(2);

    const manifest = parseManifest(dataEntries);
    expect(manifest.blobsMode).toBe("separate");
    expect(manifest.includeBlobs).toBe(true);
    expect(manifest.blobs).toEqual({ count: 2, totalBytes: bytesA.length + bytesB.length });

    // Blobs archive: ONLY blob entries (no manifest), matching expectedBlobs.
    const blobEntries = await readArchive(result.blobsArchivePath!);
    expect(blobEntries.every(e => e.name.startsWith("blobs/"))).toBe(true);
    expect(blobEntries.map(e => e.name).sort()).toEqual(
      manifest.expectedBlobs!.map(b => `blobs/${b.storageKey}`).sort(),
    );
    const entryA = blobEntries.find(e => e.name === `blobs/${deriveStorageKey(shaA)}`)!;
    expect(entryA.data.equals(Buffer.from(bytesA))).toBe(true);
    const entryB = blobEntries.find(e => e.name === `blobs/${keyB}`)!;
    expect(entryB.data.equals(Buffer.from(bytesB))).toBe(true);
  });
});

describe("writeArchiveV2 — staging hygiene", () => {
  test("renames .partial on success and removes tmp/", async () => {
    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["settings"],
      blobsMode: "none",
      stagingDir,
      appName: "app",
    });
    expect(archivePath).toBe(resolve(stagingDir, "archive.tar.gz"));
    expect(existsSync(archivePath)).toBe(true);
    expect(existsSync(resolve(stagingDir, "archive.tar.gz.partial"))).toBe(false);
    expect(existsSync(resolve(stagingDir, "tmp"))).toBe(false);
  });

  test("a flipped abort flag rejects with ExportCancelledError", async () => {
    expect(writeArchiveV2({
      db,
      modules: ["settings"],
      blobsMode: "none",
      stagingDir,
      appName: "app",
      isCancelled: () => true,
    })).rejects.toBeInstanceOf(ExportCancelledError);
  });
});
