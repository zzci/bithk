import type { Headers } from "tar-stream";
import type { BackupManifestV2, ManifestColumn, ManifestTable } from "./archive.service";
import type { ImportApplyActor } from "./import-apply";
import type { ImportJob } from "./import.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { pack as tarPack } from "tar-stream";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { createSession } from "@/modules/account/auth/auth.service";
import { auditEvents } from "@/modules/audit/schema";
import { fileBackupContribution } from "@/modules/file/file.backup";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { __setLocalDriverRootForTests, localDriver } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { AppError } from "@/shared/lib/errors";
import { seedUser, stubLogger, testConfig, testNanoid } from "@/shared/test/route-harness";
import { writeArchiveV2 } from "./archive.service";
import { rescanQuarantinedFiles, restoreBlobArchive } from "./blob-restore";
import { __resetImportApplyForTests, startImportApply } from "./import-apply";
import { __resetImportJobsForTests, prepareImport } from "./import.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

const ACTOR: ImportApplyActor = { id: "apply-tester", name: "Apply Tester", ip: "127.0.0.1", userAgent: "test" };

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-apply-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  config = testConfig({ DATA_DIR: baseDir });
  __resetBackupRegistryForTests();
  __resetImportJobsForTests();
  __resetImportApplyForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
  registerBackupContribution(fileBackupContribution);
  registerDriver(localDriver);
  __setLocalDriverRootForTests(resolve(baseDir, "blob-root"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  __resetImportJobsForTests();
  __resetImportApplyForTests();
  __resetDriverRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

// ─── Fixtures ────────────────────────────────────────────────────────────

interface TestEntry {
  readonly name: string;
  readonly data?: string | Uint8Array;
  readonly type?: Headers["type"];
}

async function packTarGz(entries: TestEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  const pack = tarPack();
  const drained = (async () => {
    const out: Buffer[] = [];
    for await (const chunk of pack as AsyncIterable<Buffer>)
      out.push(chunk);
    return Buffer.concat(out);
  })();
  for (const entry of entries)
    pack.entry({ name: entry.name, type: entry.type ?? "file" }, Buffer.from(entry.data ?? ""));
  pack.finalize();
  return Bun.gzipSync(await drained) as Uint8Array<ArrayBuffer>;
}

async function archiveFile(entries: TestEntry[]): Promise<File> {
  return new File([await packTarGz(entries)], "backup.tar.gz", { type: "application/gzip" });
}

function col(name: string, type = "text", notNull = true, extra: Partial<ManifestColumn> = {}): ManifestColumn {
  return { name, type, notNull, ...extra };
}

function settingsTableDef(): ManifestTable {
  return {
    name: "settings",
    module: "settings",
    file: "data/settings.ndjson",
    rowCount: 1,
    primaryKey: ["key"],
    columns: [col("key"), col("value"), col("updatedBy", "text", false), col("updatedAt")],
  };
}

// Journal values are informational since FIX-062 removed the replace-mode
// schema gate — the merge engine never compares them.
const TEST_JOURNAL = { lastIdx: 0, lastTag: "0000_test", entryCount: 1 };

function baseManifest(overrides: Partial<BackupManifestV2> = {}): BackupManifestV2 {
  return {
    format: "bithk-backup",
    formatVersion: 2,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: TEST_JOURNAL },
    redacted: false,
    includeBlobs: false,
    blobsMode: "none",
    modules: [{ name: "settings", deps: [] }],
    tables: [settingsTableDef()],
    blobs: { count: 0, totalBytes: 0 },
    warnings: [],
    ...overrides,
  };
}

const SETTINGS_ROW = `${JSON.stringify({ key: "k1", value: "v1", updatedBy: null, updatedAt: "2026-01-01T00:00:00Z" })}\n`;

async function stagedJob(entries: TestEntry[], target: AppDatabase = db): Promise<ImportJob> {
  return prepareImport(target, config, await archiveFile(entries));
}

async function apply(job: ImportJob, target: AppDatabase = db): Promise<void> {
  await startImportApply(target, job, { actor: ACTOR }, stubLogger);
  await job.done;
}

async function rows(target: AppDatabase, table: string): Promise<unknown[]> {
  return target.all(sql`SELECT * FROM ${sql.identifier(table)} ORDER BY 1`);
}

function sha256Of(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

function filesTableDef(): ManifestTable {
  return {
    name: "files",
    module: "files",
    file: "data/files.ndjson",
    rowCount: 1,
    primaryKey: ["id"],
    columns: [
      col("id"),
      col("sha256"),
      col("size", "integer"),
      col("mimetype"),
      col("storageDriver"),
      col("storageKey"),
      col("refCount", "integer"),
      col("uploadedBy", "text", true, { references: "users.id" }),
    ],
  };
}

function usersTableDef(rowCount = 1): ManifestTable {
  return {
    name: "users",
    module: "users",
    file: "data/users.ndjson",
    rowCount,
    primaryKey: ["id"],
    columns: [col("id"), col("oauthSub"), col("username"), col("name"), col("email"), col("role"), col("status")],
  };
}

// ─── Round trips (FIX-062: DB-data-only export + external blobs) ─────────

describe("merge apply — round trip", () => {
  test("export → import WITHOUT storage copy quarantines; copy bytes + rescan heals; download driver restored", async () => {
    const u1 = await seedUser(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k1', 'v1', '2026-01-01T00:00:00Z')`);
    const bytes = new TextEncoder().encode("round-trip blob bytes");
    const sha = sha256Of(bytes);
    await localDriver.put(deriveStorageKey(sha), bytes.buffer as ArrayBuffer);
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('f1', ${sha}, ${bytes.length}, 'text/plain', 'local', ${deriveStorageKey(sha)}, 0, ${u1})
    `);

    const { archivePath, manifest } = await writeArchiveV2({
      db,
      modules: ["users", "settings", "files"],
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });
    // FIX-062 export policy: no bytes, external marker, expected list intact.
    expect(manifest.blobsMode).toBe("external");
    expect(manifest.includeBlobs).toBe(false);
    expect(manifest.blobs).toEqual({ count: 0, totalBytes: 0 });
    expect(manifest.expectedBlobs).toEqual([
      { sha256: sha, size: bytes.length, storageKey: deriveStorageKey(sha), storageDriver: "local" },
    ]);

    // Fresh empty deployment WITHOUT copying the storage tree.
    const db2 = await createDb(resolve(baseDir, "db2.db"));
    __setLocalDriverRootForTests(resolve(baseDir, "blob-root-2"));
    try {
      const job = await prepareImport(db2, config, Bun.file(archivePath));
      await apply(job, db2);

      expect(job.state).toBe("completed");
      const result = job.result!;
      expect(result.mode).toBe("merge");
      for (const table of ["users", "settings"])
        expect(await rows(db2, table)).toEqual(await rows(db, table));
      // The expected blob is reported missing and the row quarantined.
      expect(result.blobs).toMatchObject({ written: 0, missing: 1 });
      expect(result.rescan).toEqual({ scanned: 0, healed: 0, stillMissing: 0 });
      expect(result.reconcile).toEqual({ checked: 1, quarantined: 1 });
      const quarantined = await db2.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
      expect(quarantined[0]!.storage_driver).toStartWith("quarantined:");

      // Copy the blob to its content-addressed path, then rescan → healed.
      await localDriver.put(deriveStorageKey(sha), bytes.buffer as ArrayBuffer);
      const rescan = await rescanQuarantinedFiles(db2, stubLogger);
      expect(rescan).toEqual({ scanned: 1, healed: 1, stillMissing: 0 });
      const healed = await db2.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
      expect(healed[0]!.storage_driver).toBe("local");
      // Re-running the rescan is a no-op.
      expect(await rescanQuarantinedFiles(db2, stubLogger)).toEqual({ scanned: 0, healed: 0, stillMissing: 0 });
    }
    finally {
      db2.close();
    }
  });

  test("storage tree copied BEFORE import: end-of-apply rescan + reconcile leave zero quarantine", async () => {
    const u1 = await seedUser(db, "admin");
    const bytes = new TextEncoder().encode("pre-copied blob");
    const sha = sha256Of(bytes);
    await localDriver.put(deriveStorageKey(sha), bytes.buffer as ArrayBuffer);
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('f1', ${sha}, ${bytes.length}, 'text/plain', 'local', ${deriveStorageKey(sha)}, 0, ${u1})
    `);
    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["users", "files"],
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });

    const db2 = await createDb(resolve(baseDir, "db2.db"));
    __setLocalDriverRootForTests(resolve(baseDir, "blob-root-2"));
    try {
      // Operator copies the storage tree FIRST (same content-addressed path).
      await localDriver.put(deriveStorageKey(sha), bytes.buffer as ArrayBuffer);
      const job = await prepareImport(db2, config, Bun.file(archivePath));
      await apply(job, db2);

      expect(job.state).toBe("completed");
      expect(job.result!.blobs).toMatchObject({ written: 0, missing: 0 });
      expect(job.result!.reconcile).toEqual({ checked: 1, quarantined: 0 });
      const fileRow = await db2.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
      expect(fileRow[0]!.storage_driver).toBe("local");
    }
    finally {
      db2.close();
    }
  });

  test("back-compat: a legacy blob-embedded archive still imports its blob bytes", async () => {
    const u1 = await seedUser(db, "admin");
    const bytes = new TextEncoder().encode("legacy embedded blob");
    const sha = sha256Of(bytes);
    const manifest = baseManifest({
      includeBlobs: true,
      blobsMode: "embedded",
      expectedBlobs: [{ sha256: sha, size: bytes.length, storageKey: deriveStorageKey(sha), storageDriver: "local" }],
      modules: [{ name: "files", deps: ["users"] }],
      tables: [filesTableDef()],
      blobs: { count: 1, totalBytes: bytes.length },
    });
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/files.ndjson", data: `${JSON.stringify({ id: "f1", sha256: sha, size: bytes.length, mimetype: "text/plain", storageDriver: "local", storageKey: deriveStorageKey(sha), refCount: 0, uploadedBy: u1 })}\n` },
      { name: `blobs/${deriveStorageKey(sha)}`, data: bytes },
    ]);
    await apply(job);

    expect(job.state).toBe("completed");
    expect(job.result!.blobs).toMatchObject({ written: 1, failed: 0, missing: 0 });
    expect(job.result!.reconcile).toEqual({ checked: 1, quarantined: 0 });
    expect(await localDriver.exists(deriveStorageKey(sha))).toBe(true);
  });

  test("back-compat: a legacy separate blobs.tar.gz still restores via the blob-restore endpoint machinery", async () => {
    const u1 = await seedUser(db, "admin");
    const bytes = new TextEncoder().encode("legacy separate blob");
    const sha = sha256Of(bytes);
    // Data archive marked `separate` (legacy) with no blob entries.
    const manifest = baseManifest({
      includeBlobs: true,
      blobsMode: "separate",
      expectedBlobs: [{ sha256: sha, size: bytes.length, storageKey: deriveStorageKey(sha), storageDriver: "local" }],
      modules: [{ name: "files", deps: ["users"] }],
      tables: [filesTableDef()],
      blobs: { count: 1, totalBytes: bytes.length },
    });
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/files.ndjson", data: `${JSON.stringify({ id: "f1", sha256: sha, size: bytes.length, mimetype: "text/plain", storageDriver: "local", storageKey: deriveStorageKey(sha), refCount: 0, uploadedBy: u1 })}\n` },
    ]);
    await apply(job);
    expect(job.state).toBe("completed");
    expect(job.result!.blobs).toMatchObject({ written: 0, missing: 0, expectedInSeparateArchive: 1 });
    expect(job.result!.reconcile).toEqual({ checked: 1, quarantined: 1 });

    // The legacy blobs.tar.gz upload heals the quarantined row.
    const blobsArchive = new File([await packTarGz([{ name: `blobs/${deriveStorageKey(sha)}`, data: bytes }])], "blobs.tar.gz");
    const report = await restoreBlobArchive(db, config, blobsArchive, {}, stubLogger);
    expect(report.written).toBe(1);
    expect(report.unquarantined).toBe(1);
    expect(report.reconcile).toEqual({ checked: 1, quarantined: 0 });
    const fileRow = await db.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
    expect(fileRow[0]!.storage_driver).toBe("local");
  });
});

// ─── Merge semantics at apply level ──────────────────────────────────────

describe("merge apply — semantics & dry-run parity", () => {
  test("duplicate-PK skip, child-of-skipped-parent inserts, missing-parent fails; dry-run report == apply report", async () => {
    const u1 = await seedUser(db, "user");
    const manifest = baseManifest({
      modules: [{ name: "users", deps: [] }, { name: "settings", deps: [] }],
      tables: [
        {
          name: "users",
          module: "users",
          file: "data/users.ndjson",
          rowCount: 1,
          primaryKey: ["id"],
          columns: [col("id"), col("oauthSub"), col("username"), col("name"), col("email")],
        },
        {
          name: "user_preferences",
          module: "users",
          file: "data/user_preferences.ndjson",
          rowCount: 2,
          primaryKey: ["userId", "key"],
          columns: [col("userId", "text", true, { references: "users.id" }), col("key"), col("value"), col("updatedAt")],
        },
        settingsTableDef(),
      ],
    });
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/users.ndjson", data: `${JSON.stringify({ id: u1, oauthSub: "dup", username: "dup", name: "dup", email: "dup@t" })}\n` },
      { name: "data/user_preferences.ndjson", data: [
        JSON.stringify({ userId: u1, key: "theme", value: "dark", updatedAt: "2026-01-01T00:00:00Z" }),
        JSON.stringify({ userId: "ghost", key: "lang", value: "en", updatedAt: "2026-01-01T00:00:00Z" }),
      ].join("\n") },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);

    const dryRun = job.report;
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.tables.users!.skippedDuplicate).toBe(1);
    expect(dryRun.tables.user_preferences!.inserted).toBe(1);
    expect(dryRun.tables.user_preferences!.failed.total).toBe(1);
    expect(dryRun.tables.user_preferences!.failed.sample[0]!.reason).toBe("missing-parent");
    expect(dryRun.tables.settings!.inserted).toBe(1);

    await apply(job);
    expect(job.state).toBe("completed");
    const result = job.result!;

    // Exact dry-run == apply parity on the engine portion of the report.
    expect(result.tables).toEqual(dryRun.tables);
    expect(result.totals).toEqual(dryRun.totals);
    expect(result.skippedTables).toEqual(dryRun.skippedTables);
    expect(result.skippedModules).toEqual(dryRun.skippedModules);

    // This time the rows actually landed.
    const prefs = await db.all<{ user_id: string; key: string }>(sql`SELECT user_id, key FROM user_preferences`);
    expect(prefs).toEqual([{ user_id: u1, key: "theme" }]);
    expect(await db.all(sql`SELECT key FROM settings`)).toEqual([{ key: "k1" }]);
  });

  test("a live table with neither PK nor unique index appends rows and flags no-key-append", async () => {
    await db.run(sql`CREATE TABLE keyless_notes (note text NOT NULL, extra text)`);
    const keylessNotes = sqliteTable("keyless_notes", { note: text("note").notNull(), extra: text("extra") });
    registerBackupContribution({ name: "notes", tables: [keylessNotes], deps: [] });

    const manifest = baseManifest({
      modules: [{ name: "notes", deps: [] }],
      tables: [{
        name: "keyless_notes",
        module: "notes",
        file: "data/keyless_notes.ndjson",
        rowCount: 2,
        primaryKey: [],
        columns: [col("note"), col("extra", "text", false)],
      }],
    });
    const row = JSON.stringify({ note: "same", extra: null });
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/keyless_notes.ndjson", data: `${row}\n${row}\n` },
    ]);

    await apply(job);
    expect(job.state).toBe("completed");
    expect(job.result!.tables.keyless_notes!.noKeyAppend).toBe(true);
    expect(job.result!.tables.keyless_notes!.inserted).toBe(2);
    expect(await db.all(sql`SELECT * FROM keyless_notes`)).toHaveLength(2);
  });

  test("FIX-060: a unique-key parent collision remaps children instead of aborting COMMIT", async () => {
    const u1 = await seedUser(db, "user");
    const manifest = baseManifest({
      modules: [{ name: "users", deps: [] }, { name: "settings", deps: [] }],
      tables: [
        {
          name: "users",
          module: "users",
          file: "data/users.ndjson",
          rowCount: 1,
          primaryKey: ["id"],
          columns: [col("id"), col("oauthSub"), col("username"), col("name"), col("email")],
        },
        {
          name: "user_preferences",
          module: "users",
          file: "data/user_preferences.ndjson",
          rowCount: 1,
          primaryKey: ["userId", "key"],
          columns: [col("userId", "text", true, { references: "users.id" }), col("key"), col("value"), col("updatedAt")],
        },
        settingsTableDef(),
      ],
    });
    // u2x collides with the live user on the unique oauth_sub under a
    // DIFFERENT id. Pre-FIX-060 this admitted the prefs row on the incoming
    // promise and aborted the whole apply at COMMIT with a raw FK error;
    // now the parent skips as remapped and the child lands under u1.
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/users.ndjson", data: `${JSON.stringify({ id: "u2x", oauthSub: `sub-${u1}`, username: "other", name: "o", email: "o@t" })}\n` },
      { name: "data/user_preferences.ndjson", data: `${JSON.stringify({ userId: "u2x", key: "theme", value: "dark", updatedAt: "t" })}\n` },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);

    await apply(job);
    expect(job.state).toBe("completed");
    const result = job.result!;
    expect(result.tables.users!.skippedDuplicate).toBe(1);
    expect(result.tables.users!.remapped).toBe(1);
    expect(result.tables.user_preferences!.inserted).toBe(1);
    expect(result.totals.failed).toBe(0);
    // Dry-run preview matches the apply outcome (FIX-060 point 4).
    expect(result.tables).toEqual(job.report.tables);
    // The child references the LIVE parent id.
    const prefs = await db.all<{ user_id: string; key: string }>(sql`SELECT user_id, key FROM user_preferences`);
    expect(prefs).toEqual([{ user_id: u1, key: "theme" }]);
    expect(await db.all(sql`SELECT key FROM settings`)).toEqual([{ key: "k1" }]);
  });

  test("FIX-060 repro: two independently seeded deployments merge-import cleanly with remapped ids", async () => {
    // Deployment A (source): admin created by the shared IdP.
    await db.run(sql`
      INSERT INTO users (id, oauth_sub, username, name, email, role, status, created_at, updated_at)
      VALUES ('idA', 'dex-admin', 'admin-a', 'Admin', 'admin@bit.hk', 'admin', 'active', 't', 't')
    `);
    await db.run(sql`INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES ('idA', 'theme', 'dark', 't')`);
    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["users"],
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });

    // Deployment B (target): SAME logical admin under a different id.
    const db2 = await createDb(resolve(baseDir, "db2.db"));
    try {
      await db2.run(sql`
        INSERT INTO users (id, oauth_sub, username, name, email, role, status, created_at, updated_at)
        VALUES ('idB', 'dex-admin', 'admin-b', 'Admin', 'admin@bit.hk', 'admin', 'active', 't', 't')
      `);

      const job = await prepareImport(db2, config, Bun.file(archivePath));
      await apply(job, db2);

      expect(job.state).toBe("completed");
      const result = job.result!;
      expect(result.tables.users!.skippedDuplicate).toBe(1);
      expect(result.tables.users!.remapped).toBe(1);
      expect(result.tables.user_preferences!.inserted).toBe(1);
      expect(result.totals.failed).toBe(0);
      // The imported child row references B's live user id, not A's.
      const prefs = await db2.all<{ user_id: string; key: string }>(sql`SELECT user_id, key FROM user_preferences`);
      expect(prefs).toEqual([{ user_id: "idB", key: "theme" }]);
    }
    finally {
      db2.close();
    }
  });
});

// ─── State machine & concurrency ─────────────────────────────────────────

describe("apply state machine", () => {
  test("re-apply of a completed import is refused", async () => {
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await apply(job);
    expect(job.state).toBe("completed");
    await expect(startImportApply(db, job, { actor: ACTOR }, stubLogger))
      .rejects
      .toMatchObject({ code: "IMPORT_ALREADY_APPLIED" });
  });

  test("one apply at a time process-wide — a concurrent apply gets 409", async () => {
    const entries: TestEntry[] = [
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ];
    const jobA = await stagedJob(entries);
    const jobB = await stagedJob(entries);

    await startImportApply(db, jobA, { actor: ACTOR }, stubLogger);
    // jobA is applying in the background; jobB must be refused NOW.
    await expect(startImportApply(db, jobB, { actor: ACTOR }, stubLogger))
      .rejects
      .toMatchObject({ code: "IMPORT_APPLY_IN_PROGRESS" });
    await jobA.done;
    expect(jobA.state).toBe("completed");
    // The guard releases once the runner exits.
    await apply(jobB);
    expect(jobB.state).toBe("completed");
    expect(jobB.result!.totals.skippedDuplicate).toBe(1);
  });

  test("the backup.import.apply audit row is written with mode + per-table counts + rescan", async () => {
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await apply(job);
    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.apply")).get();
    expect(auditRow).toBeDefined();
    expect(auditRow!.actorId).toBe(ACTOR.id);
    const detail = JSON.parse(auditRow!.detail!) as { mode: string; tables: Record<string, { inserted: number }>; rescan: unknown };
    expect(detail.mode).toBe("merge");
    expect(detail.tables.settings!.inserted).toBe(1);
    expect(detail.rescan).toEqual({ scanned: 0, healed: 0, stillMissing: 0 });
  });
});

// ─── Misc ────────────────────────────────────────────────────────────────

describe("apply errors", () => {
  test("startImportApply rejects with AppError instances", async () => {
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    job.state = "completed";
    try {
      await startImportApply(db, job, { actor: ACTOR }, stubLogger);
      throw new Error("expected startImportApply to reject");
    }
    catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    }
  });
});

// ─── Wipe-before-merge (FIX-061) + session-safe wipe (FIX-062) ──────────

describe("wipe-before-merge (FIX-061/FIX-062)", () => {
  const wipeManifest = (rowCount = 1) => baseManifest({
    modules: [{ name: "users", deps: [] }, { name: "settings", deps: [] }],
    tables: [usersTableDef(rowCount), settingsTableDef()],
  });
  const archiveAdmin = (id: string, email = `${id}@archive.test`) =>
    JSON.stringify({ id, oauthSub: `sub-${id}`, username: id, name: id, email, role: "admin", status: "active" });

  async function applyWipe(job: ImportJob, actor: ImportApplyActor): Promise<void> {
    await startImportApply(db, job, { wipeExisting: true, actor }, stubLogger);
    await job.done;
  }

  test("wipe+merge into a populated DB: old rows gone, sessions cleared, wipe counts + audit detail", async () => {
    const liveAdmin = await seedUser(db, "admin");
    await createSession(db, liveAdmin, "tok-live", undefined, 3600);
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k_live', 'old', '2026-01-01T00:00:00Z')`);

    // Web actor: the live admin, matched in the archive by EMAIL under a
    // different id (cross-instance archive). No sessionId → no preservation.
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(wipeManifest()) },
      { name: "data/users.ndjson", data: `${archiveAdmin("adminx", `${liveAdmin}@test.com`)}\n` },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await applyWipe(job, { ...ACTOR, id: liveAdmin });

    expect(job.state).toBe("completed");
    const result = job.result!;
    // Nothing to collide with after the wipe.
    expect(result.totals).toMatchObject({ inserted: 2, skippedDuplicate: 0, failed: 0 });
    expect(result.wipe).toEqual({ tables: { users: 1, settings: 1 }, total: 2 });

    // Old rows gone, archive rows present, all pre-wipe sessions revoked.
    expect(await db.all(sql`SELECT id FROM users`)).toEqual([{ id: "adminx" }]);
    expect(await db.all(sql`SELECT key FROM settings`)).toEqual([{ key: "k1" }]);
    expect(await db.all(sql`SELECT * FROM sessions`)).toHaveLength(0);
    expect(await db.all(sql`PRAGMA foreign_key_check`)).toHaveLength(0);

    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.apply")).get();
    expect(JSON.parse(auditRow!.detail!)).toMatchObject({ mode: "merge", wipeExisting: true, wipe: { total: 2 } });
  });

  test("FIX-062: a web actor's session survives a wipe — same token re-bound to the archive admin matched by id", async () => {
    const liveAdmin = await seedUser(db, "admin");
    const sessionId = await createSession(db, liveAdmin, "tok-live", undefined, 3600);
    const liveUser = await db.all<{ email: string; oauth_sub: string }>(sql`SELECT email, oauth_sub FROM users WHERE id = ${liveAdmin}`);

    // The archive carries the SAME admin id (same-instance archive).
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(wipeManifest()) },
      { name: "data/users.ndjson", data: `${JSON.stringify({ id: liveAdmin, oauthSub: liveUser[0]!.oauth_sub, username: "admin", name: "Admin", email: liveUser[0]!.email, role: "admin", status: "active" })}\n` },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await applyWipe(job, { ...ACTOR, id: liveAdmin, sessionId });

    expect(job.state).toBe("completed");
    const sessions = await db.all<{ id: string; user_id: string }>(sql`SELECT id, user_id FROM sessions`);
    expect(sessions).toEqual([{ id: sessionId, user_id: liveAdmin }]);
  });

  test("FIX-062: cross-instance wipe re-binds the session to the archive admin matched by email under a new id", async () => {
    const liveAdmin = await seedUser(db, "admin");
    const sessionId = await createSession(db, liveAdmin, "tok-live", undefined, 3600);

    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(wipeManifest()) },
      { name: "data/users.ndjson", data: `${archiveAdmin("adminx", `${liveAdmin}@test.com`)}\n` },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await applyWipe(job, { ...ACTOR, id: liveAdmin, sessionId });

    expect(job.state).toBe("completed");
    // Same token, now bound to the restored admin's id.
    const sessions = await db.all<{ id: string; user_id: string; access_token: string }>(sql`SELECT id, user_id, access_token FROM sessions`);
    expect(sessions).toEqual([{ id: sessionId, user_id: "adminx", access_token: "tok-live" }]);
    expect(await db.all(sql`PRAGMA foreign_key_check`)).toHaveLength(0);
  });

  test("lockout guard: an archive without an active admin is refused BEFORE any deletion", async () => {
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k_live', 'keep', '2026-01-01T00:00:00Z')`);
    // Disabled admin + active plain user — nobody can hold the instance.
    const rows = [
      JSON.stringify({ id: "a1", oauthSub: "s-a1", username: "a1", name: "a1", email: "a1@t", role: "admin", status: "disabled" }),
      JSON.stringify({ id: "u1", oauthSub: "s-u1", username: "u1", name: "u1", email: "u1@t", role: "user", status: "active" }),
    ].join("\n");
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(wipeManifest(2)) },
      { name: "data/users.ndjson", data: `${rows}\n` },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);

    await expect(startImportApply(db, job, { wipeExisting: true, actor: ACTOR }, stubLogger))
      .rejects
      .toMatchObject({ code: "WIPE_WOULD_LOCK_OUT" });
    // Refused before the state flip — nothing was deleted, job retryable.
    expect(job.state).toBe("validated");
    expect(await db.all(sql`SELECT key FROM settings`)).toEqual([{ key: "k_live" }]);
  });

  test("lockout guard: a WEB actor with no matching active-admin archive row is refused; CLI actor passes", async () => {
    const liveAdmin = await seedUser(db, "admin");
    const entries: TestEntry[] = [
      { name: "manifest.json", data: JSON.stringify(wipeManifest()) },
      // Active admin, but matches the live actor neither by id nor email/oauthSub.
      { name: "data/users.ndjson", data: `${archiveAdmin("stranger")}\n` },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ];

    const webJob = await stagedJob(entries);
    await expect(startImportApply(db, webJob, { wipeExisting: true, actor: { ...ACTOR, id: liveAdmin } }, stubLogger))
      .rejects
      .toMatchObject({ code: "WIPE_WOULD_LOCK_OUT" });
    expect(webJob.state).toBe("validated");
    expect(await db.all(sql`SELECT id FROM users`)).toEqual([{ id: liveAdmin }]);

    // A synthetic CLI actor (no live users row) only needs the >=1-active-admin check.
    const cliJob = await stagedJob(entries);
    await applyWipe(cliJob, { ...ACTOR, id: "cli" });
    expect(cliJob.state).toBe("completed");
    expect(await db.all(sql`SELECT id FROM users`)).toEqual([{ id: "stranger" }]);
  });

  test("flag off: apply carries no wipe key and audit detail is unchanged", async () => {
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k_live', 'keep', '2026-01-01T00:00:00Z')`);
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await apply(job);
    expect(job.state).toBe("completed");
    expect(job.result!.wipe).toBeUndefined();
    expect(await db.all(sql`SELECT key FROM settings ORDER BY key`)).toEqual([{ key: "k1" }, { key: "k_live" }]);
    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.apply")).get();
    expect(JSON.parse(auditRow!.detail!)).not.toContainKey("wipeExisting");
  });
});
