import type { BackupManifestV2 } from "./archive.service";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { extract as tarExtract } from "tar-stream";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { cronBackupContribution } from "@/modules/cron/cron.backup";
import { fileBackupContribution } from "@/modules/file/file.backup";
import { legacyContentAddressedKey } from "@/modules/file/storage/key";
import { __setLocalDriverRootForTests, localDriver } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { seedUser, testNanoid } from "@/shared/test/route-harness";
import { ExportCancelledError, streamBatchSizeFor, streamTableRows, writeArchiveV2 } from "./archive.service";
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
  const key = legacyContentAddressedKey(sha256);
  await localDriver.put(key, bytes.buffer as ArrayBuffer);
  return key;
}

async function insertFileRow(id: string, sha256: string, size: number, driver: string, uploadedBy: string): Promise<void> {
  await db.run(sql`
    INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
    VALUES (${id}, ${sha256}, ${size}, 'application/octet-stream', ${driver}, ${legacyContentAddressedKey(sha256)}, 1, ${uploadedBy})
  `);
}

describe("writeArchiveV2 — manifest", () => {
  test("manifest.json is the first entry and describes journal, modules, tables", async () => {
    await seedUser(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('app.theme', 'dark', '2026-01-01T00:00:00Z')`);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["files", "settings"],
      stagingDir,
      appName: "app",
    });

    const entries = await readArchive(archivePath);
    expect(entries[0]!.name).toBe("manifest.json");
    const fromArchive = parseManifest(entries);
    expect(fromArchive).toEqual(JSON.parse(JSON.stringify(manifest)) as BackupManifestV2);

    expect(fromArchive.format).toBe("bithk-backup");
    expect(fromArchive.formatVersion).toBe(3);
    expect(fromArchive.redacted).toBe(false);
    // FIX-062: bytes are never packed — external marker, alias false.
    expect(fromArchive.blobsMode).toBe("external");
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
      stagingDir,
      appName: "app",
    });
    const entries = await readArchive(archivePath);

    const usersRows = parseNdjson(entries.find(e => e.name === "data/users.ndjson")!);
    expect(usersRows).toEqual(v1Dump.tables.users!);
    // 1500 rows spans two keyset batches. v2 keysets on the `key` PK
    // (lexicographic) while v1 pages by OFFSET (insertion order) — compare
    // as sets under one order.
    const byKey = (a: Record<string, unknown>, b: Record<string, unknown>): number => String(a.key).localeCompare(String(b.key));
    const settingsRows = parseNdjson(entries.find(e => e.name === "data/settings.ndjson")!);
    expect([...settingsRows].sort(byKey)).toEqual([...v1Dump.tables.settings!].sort(byKey));
  });
});

describe("writeArchiveV2 — blobs (FIX-062: DB data only)", () => {
  test("no blob bytes are packed for any driver; expectedBlobs inventories every referenced blob", async () => {
    const userId = await seedUser(db, "admin");
    const shaShared = "ab".repeat(32);
    const shaForeign = "cd".repeat(32);
    const shaDb = "ef".repeat(32);
    const shaUnknown = "12".repeat(32);
    const bytes = new Uint8Array(256 * 1024).fill(42);
    await setUpLocalBlob(shaShared, bytes);

    // Rows across every driver kind — including a readable local blob: the
    // exporter must not pack ANY of them (file bytes are the operator's
    // storage-tree/bucket copy).
    await insertFileRow("f1", shaShared, bytes.length, "local", userId);
    await insertFileRow("f2", shaShared, bytes.length, "s3", userId);
    await insertFileRow("f3", shaForeign, 10, "s3", userId);
    await insertFileRow("f4", shaDb, 20, "db", userId);
    await insertFileRow("f5", shaUnknown, 30, "quarantined:backup-restore-missing-blob", userId);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["files"],
      stagingDir,
      appName: "app",
    });

    const entries = await readArchive(archivePath);
    expect(entries.some(e => e.name.startsWith("blobs/"))).toBe(false);

    expect(manifest.blobsMode).toBe("external");
    expect(manifest.includeBlobs).toBe(false);
    expect(manifest.blobs).toEqual({ count: 0, totalBytes: 0 });
    // expectedBlobs lists EVERY referenced blob, on any driver.
    const key = (b: { sha256: string; storageDriver?: string }): string => `${b.sha256}/${b.storageDriver}`;
    expect([...manifest.expectedBlobs!].sort((a, b) => key(a).localeCompare(key(b)))).toEqual([
      { sha256: shaShared, size: bytes.length, storageKey: legacyContentAddressedKey(shaShared), storageDriver: "local" },
      { sha256: shaShared, size: bytes.length, storageKey: legacyContentAddressedKey(shaShared), storageDriver: "s3" },
      { sha256: shaForeign, size: 10, storageKey: legacyContentAddressedKey(shaForeign), storageDriver: "s3" },
      { sha256: shaDb, size: 20, storageKey: legacyContentAddressedKey(shaDb), storageDriver: "db" },
      { sha256: shaUnknown, size: 30, storageKey: legacyContentAddressedKey(shaUnknown), storageDriver: "quarantined:backup-restore-missing-blob" },
    ].sort((a, b) => key(a).localeCompare(key(b))));
    // No per-blob export warnings — bytes are out of scope by design.
    expect(manifest.warnings).toEqual([]);
    // Rows still export in full.
    expect(manifest.tables.find(t => t.name === "files")!.rowCount).toBe(5);
    expect(parseNdjson(entries.find(e => e.name === "data/files.ndjson")!)).toHaveLength(5);
  });
});

// ─── Blob-column NDJSON codec + streaming pagination ──────────────────────

/** Synthetic blob-carrying table with a NON-id text PK (FEAT-047 shape). */
const blobFixtures = sqliteTable("blob_fixtures", {
  storageKey: text("storage_key").primaryKey(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  size: integer("size").notNull(),
});

async function setUpBlobFixtures(): Promise<void> {
  await db.run(sql`CREATE TABLE blob_fixtures (storage_key TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL)`);
  registerBackupContribution({ name: "blobtest", tables: [blobFixtures], deps: [] });
}

describe("writeArchiveV2 — blob-typed columns in NDJSON", () => {
  test("Buffer values serialise as base64 strings and round-trip byte-identically", async () => {
    await setUpBlobFixtures();
    const payload = Buffer.from([0, 1, 2, 250, 251, 255, 10, 13, 34, 92]);
    await db.insert(blobFixtures).values({ storageKey: "k1", bytes: payload, size: payload.length });

    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["blobtest"],
      stagingDir,
      appName: "app",
    });

    const entries = await readArchive(archivePath);
    const rows = parseNdjson(entries.find(e => e.name === "data/blob_fixtures.ndjson")!);
    expect(rows).toHaveLength(1);
    // NOT the `{type:"Buffer",data:[...]}` JSON mangle — a plain base64 string.
    expect(rows[0]!.bytes).toBe(payload.toString("base64"));
    expect(Buffer.from(rows[0]!.bytes as string, "base64").equals(payload)).toBe(true);
    // Non-blob columns are untouched.
    expect(rows[0]!.size).toBe(payload.length);
  });
});

describe("streamTableRows — pagination", () => {
  test("keysets over a single-column non-id PK across batches (blob batch size 50)", async () => {
    await setUpBlobFixtures();
    // 120 rows > 2× the blob batch size of 50 → three keyset batches.
    for (let n = 0; n < 120; n++)
      await db.insert(blobFixtures).values({ storageKey: `key-${String(n).padStart(3, "0")}`, bytes: Buffer.from([n]), size: 1 });

    const rows: Record<string, unknown>[] = [];
    for await (const row of streamTableRows(db, blobFixtures, () => false))
      rows.push(row);

    expect(rows).toHaveLength(120);
    // Keyset order + no duplicates/gaps across batch boundaries.
    expect(rows.map(r => r.storageKey)).toEqual(
      Array.from({ length: 120 }, (_, n) => `key-${String(n).padStart(3, "0")}`),
    );
  });

  test("batch size: 50 for blob-carrying tables, 1000 otherwise", async () => {
    await setUpBlobFixtures();
    const plain = sqliteTable("plain_fixtures", {
      id: text("id").primaryKey(),
      label: text("label").notNull(),
    });
    expect(streamBatchSizeFor(blobFixtures)).toBe(50);
    expect(streamBatchSizeFor(plain)).toBe(1000);
  });
});

describe("writeArchiveV2 — redaction (token-route policy)", () => {
  test("redacted:true scrubs secret-typed fields per row and flags the manifest", async () => {
    registerBackupContribution(cronBackupContribution);
    const secret = "Bearer super-secret-xyz-do-not-leak";
    await db.run(sql`
      INSERT INTO cron_jobs (id, name, cron, task_type, task_config, enabled, is_deleted, max_consecutive_failures, created_at, updated_at)
      VALUES ('job-1', 'nightly', '0 0 * * *', 'http_request', ${JSON.stringify({ url: "https://x", headers: { authorization: secret } })}, 1, 0, 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["cron"],
      redacted: true,
      stagingDir,
      appName: "app",
    });
    expect(manifest.redacted).toBe(true);

    const entries = await readArchive(archivePath);
    // The plaintext secret must never appear anywhere in the artifact.
    expect(entries.some(e => e.data.includes("super-secret-xyz"))).toBe(false);
    const rows = parseNdjson(entries.find(e => e.name === "data/cron_jobs.ndjson")!);
    const job = rows.find(r => r.id === "job-1")!;
    expect(job.taskConfig).toBe("[REDACTED]");
    // Non-secret columns survive untouched.
    expect(job.name).toBe("nightly");
  });

  test("the default stays unredacted — the admin restore-complete path", async () => {
    registerBackupContribution(cronBackupContribution);
    const secret = "Bearer keep-me-admin-export";
    await db.run(sql`
      INSERT INTO cron_jobs (id, name, cron, task_type, task_config, enabled, is_deleted, max_consecutive_failures, created_at, updated_at)
      VALUES ('job-1', 'nightly', '0 0 * * *', 'http_request', ${JSON.stringify({ url: "https://x", headers: { authorization: secret } })}, 1, 0, 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    const { manifest, archivePath } = await writeArchiveV2({
      db,
      modules: ["cron"],
      stagingDir,
      appName: "app",
    });
    expect(manifest.redacted).toBe(false);

    const entries = await readArchive(archivePath);
    const rows = parseNdjson(entries.find(e => e.name === "data/cron_jobs.ndjson")!);
    expect(rows.find(r => r.id === "job-1")!.taskConfig).toContain("keep-me-admin-export");
  });
});

describe("writeArchiveV2 — staging hygiene", () => {
  test("renames .partial on success and removes tmp/", async () => {
    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["settings"],
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
      stagingDir,
      appName: "app",
      isCancelled: () => true,
    })).rejects.toBeInstanceOf(ExportCancelledError);
  });
});
