import type { Headers } from "tar-stream";
import type { BackupManifestV2, ManifestColumn, ManifestTable } from "./archive.service";
import type { ImportApplyActor, ImportApplyMode } from "./import-apply";
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
import { restoreBlobArchive } from "./blob-restore";
import { __resetImportApplyForTests, readLiveSchemaJournal, startImportApply } from "./import-apply";
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

async function archiveFile(entries: TestEntry[]): Promise<File> {
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
  return new File([Bun.gzipSync(await drained)], "backup.tar.gz", { type: "application/gzip" });
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

/** Manifest pinned to the LIVE journal so replace-mode fixtures pass the schema gate. */
function baseManifest(overrides: Partial<BackupManifestV2> = {}): BackupManifestV2 {
  return {
    format: "bithk-backup",
    formatVersion: 2,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: readLiveSchemaJournal() },
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

async function apply(job: ImportJob, mode: ImportApplyMode = "merge", includeUsers = false, target: AppDatabase = db): Promise<void> {
  await startImportApply(target, job, { mode, includeUsers, actor: ACTOR }, stubLogger);
  await job.done;
}

async function rows(target: AppDatabase, table: string): Promise<unknown[]> {
  return target.all(sql`SELECT * FROM ${sql.identifier(table)} ORDER BY 1`);
}

function sha256Of(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

// ─── Round trips ─────────────────────────────────────────────────────────

describe("merge apply — round trip", () => {
  test("embedded export → merge into an empty DB → table equality + blobs on driver + zero quarantine", async () => {
    const u1 = await seedUser(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k1', 'v1', '2026-01-01T00:00:00Z')`);
    const bytes = new TextEncoder().encode("round-trip blob bytes");
    const sha = sha256Of(bytes);
    await localDriver.put(deriveStorageKey(sha), bytes.buffer as ArrayBuffer);
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('f1', ${sha}, ${bytes.length}, 'text/plain', 'local', ${deriveStorageKey(sha)}, 0, ${u1})
    `);

    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["users", "settings", "files"],
      blobsMode: "embedded",
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });

    // Fresh empty deployment: second DB, second (empty) blob root.
    const db2 = await createDb(resolve(baseDir, "db2.db"));
    __setLocalDriverRootForTests(resolve(baseDir, "blob-root-2"));
    try {
      const job = await prepareImport(db2, config, Bun.file(archivePath));
      await apply(job, "merge", false, db2);

      expect(job.state).toBe("completed");
      const result = job.result!;
      expect(result.dryRun).toBe(false);
      expect(result.mode).toBe("merge");
      for (const table of ["users", "settings", "files"])
        expect(await rows(db2, table)).toEqual(await rows(db, table));
      expect(await localDriver.exists(deriveStorageKey(sha))).toBe(true);
      expect(result.blobs).toMatchObject({ written: 1, skippedExisting: 0, failed: 0, missing: 0, expectedInSeparateArchive: 0 });
      expect(result.reconcile).toEqual({ checked: 1, quarantined: 0 });

      // Idempotence: a second identical import is pure duplicates + exists-skips.
      const again = await prepareImport(db2, config, Bun.file(archivePath));
      await apply(again, "merge", false, db2);
      expect(again.state).toBe("completed");
      expect(again.result!.totals.inserted).toBe(0);
      expect(again.result!.totals.skippedDuplicate).toBe(3); // user + setting + file row
      expect(again.result!.blobs).toMatchObject({ written: 0, skippedExisting: 1, failed: 0 });
      expect(again.result!.reconcile).toEqual({ checked: 1, quarantined: 0 });
    }
    finally {
      db2.close();
    }
  });

  test("R7: separate export → data import reports expected-in-separate → standalone blob restore heals to zero quarantine", async () => {
    const u1 = await seedUser(db, "admin");
    const bytes = new TextEncoder().encode("separate-mode blob");
    const sha = sha256Of(bytes);
    await localDriver.put(deriveStorageKey(sha), bytes.buffer as ArrayBuffer);
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('f1', ${sha}, ${bytes.length}, 'text/plain', 'local', ${deriveStorageKey(sha)}, 0, ${u1})
    `);

    const result = await writeArchiveV2({
      db,
      modules: ["users", "files"],
      blobsMode: "separate",
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });
    expect(result.blobsArchivePath).toBeTruthy();

    const db2 = await createDb(resolve(baseDir, "db2.db"));
    __setLocalDriverRootForTests(resolve(baseDir, "blob-root-2"));
    try {
      // Step 1 — data archive: rows import; the blob is EXPECTED in the
      // separate archive (distinguished from genuinely-missing); reconcile
      // quarantines the row until the bytes arrive.
      const job = await prepareImport(db2, config, Bun.file(result.archivePath));
      await apply(job, "merge", false, db2);
      expect(job.state).toBe("completed");
      expect(job.result!.blobs).toMatchObject({ written: 0, missing: 0, expectedInSeparateArchive: 1 });
      expect(job.result!.reconcile).toEqual({ checked: 1, quarantined: 1 });

      // Step 2 — standalone blob restore of blobs.tar.gz.
      const report = await restoreBlobArchive(db2, config, Bun.file(result.blobsArchivePath!), {}, stubLogger);
      expect(report.written).toBe(1);
      expect(report.failed).toBe(0);
      expect(report.unquarantined).toBe(1);
      expect(report.reconcile).toEqual({ checked: 1, quarantined: 0 });
      expect(await localDriver.exists(deriveStorageKey(sha))).toBe(true);
      const fileRow = await db2.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
      expect(fileRow[0]!.storage_driver).toBe("local");
    }
    finally {
      db2.close();
    }
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
      blobsMode: "none",
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
      await apply(job, "merge", false, db2);

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
    await expect(startImportApply(db, job, { mode: "merge", includeUsers: false, actor: ACTOR }, stubLogger))
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

    await startImportApply(db, jobA, { mode: "merge", includeUsers: false, actor: ACTOR }, stubLogger);
    // jobA is applying in the background; jobB must be refused NOW.
    await expect(startImportApply(db, jobB, { mode: "merge", includeUsers: false, actor: ACTOR }, stubLogger))
      .rejects
      .toMatchObject({ code: "IMPORT_APPLY_IN_PROGRESS" });
    await jobA.done;
    expect(jobA.state).toBe("completed");
    // The guard releases once the runner exits.
    await apply(jobB);
    expect(jobB.state).toBe("completed");
    expect(jobB.result!.totals.skippedDuplicate).toBe(1);
  });

  test("the backup.import.apply audit row is written with mode + per-table counts", async () => {
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await apply(job);
    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.apply")).get();
    expect(auditRow).toBeDefined();
    expect(auditRow!.actorId).toBe(ACTOR.id);
    const detail = JSON.parse(auditRow!.detail!) as { mode: string; tables: Record<string, { inserted: number }> };
    expect(detail.mode).toBe("merge");
    expect(detail.tables.settings!.inserted).toBe(1);
  });
});

// ─── Replace mode ────────────────────────────────────────────────────────

describe("replace mode", () => {
  test("delete-then-insert: live rows the archive replaces are gone", async () => {
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k_live', 'old', '2026-01-01T00:00:00Z')`);
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);

    await apply(job, "replace");
    expect(job.state).toBe("completed");
    expect(job.result!.mode).toBe("replace");
    expect(job.result!.replace).toEqual({ tablesImported: 1, rowsImported: 1, includeUsers: false });
    const keys = await db.all<{ key: string }>(sql`SELECT key FROM settings`);
    expect(keys).toEqual([{ key: "k1" }]); // k_live deleted by replace
  });

  test("rejects a cross-schema archive (journal position mismatch) with a distinct error", async () => {
    const live = readLiveSchemaJournal();
    const manifest = baseManifest({
      schema: { dialect: "sqlite", journal: { ...live, lastTag: "9999_other_schema" } },
    });
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/settings.ndjson", data: SETTINGS_ROW },
    ]);
    await expect(startImportApply(db, job, { mode: "replace", includeUsers: false, actor: ACTOR }, stubLogger))
      .rejects
      .toMatchObject({ code: "REPLACE_SCHEMA_MISMATCH" });
    // A refused apply leaves the job retryable (e.g. in merge mode).
    expect(job.state).toBe("validated");
    await apply(job, "merge");
    expect(job.state).toBe("completed");
  });

  test("includeUsers=true refuses locking out the applying admin", async () => {
    const adminId = await seedUser(db, "admin");
    const manifest = baseManifest({
      modules: [{ name: "users", deps: [] }],
      tables: [{
        name: "users",
        module: "users",
        file: "data/users.ndjson",
        rowCount: 1,
        primaryKey: ["id"],
        columns: [col("id"), col("oauthSub"), col("username"), col("name"), col("email"), col("role"), col("status")],
      }],
    });
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/users.ndjson", data: `${JSON.stringify({ id: "someone-else", oauthSub: "s", username: "s", name: "s", email: "s@t", role: "admin", status: "active" })}\n` },
    ]);
    await expect(startImportApply(db, job, {
      mode: "replace",
      includeUsers: true,
      actor: { ...ACTOR, id: adminId },
    }, stubLogger)).rejects.toMatchObject({ code: "RESTORE_WOULD_LOCK_OUT" });
    expect(job.state).toBe("validated");
  });

  test("includeUsers=false user-FK pre-flight rejects rows pointing at absent users", async () => {
    const manifest = baseManifest({
      modules: [{ name: "files", deps: ["users"] }],
      tables: [{
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
      }],
    });
    const sha = "ab".repeat(32);
    const job = await stagedJob([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/files.ndjson", data: `${JSON.stringify({ id: "f1", sha256: sha, size: 1, mimetype: "t", storageDriver: "local", storageKey: deriveStorageKey(sha), refCount: 0, uploadedBy: "ghost" })}\n` },
    ]);
    await expect(startImportApply(db, job, { mode: "replace", includeUsers: false, actor: ACTOR }, stubLogger))
      .rejects
      .toMatchObject({ code: "RESTORE_FK_MISSING_USERS" });
    expect(job.state).toBe("validated");
  });

  test("includeUsers=true restores users, clears sessions (forced re-auth), audits user.restored per user", async () => {
    const adminId = await seedUser(db, "admin");
    const victimId = await seedUser(db, "user");
    await createSession(db, adminId, "tok-a", undefined, 3600);
    await createSession(db, victimId, "tok-v", undefined, 3600);
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('app.theme', 'dark', '2026-01-01T00:00:00Z')`);

    // A real, schema-valid archive that includes the applying admin.
    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["users", "settings"],
      blobsMode: "none",
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });
    const job = await prepareImport(db, config, Bun.file(archivePath));
    await startImportApply(db, job, { mode: "replace", includeUsers: true, actor: { ...ACTOR, id: adminId } }, stubLogger);
    await job.done;

    expect(job.state).toBe("completed");
    expect(job.result!.replace).toMatchObject({ includeUsers: true });

    // One user.restored row per user in the archive.
    const restored = await db.select().from(auditEvents).where(eq(auditEvents.action, "user.restored")).all();
    expect(restored).toHaveLength(2);

    // Replacing the users table cascades through the sessions FK — every
    // pre-restore session is gone (v1 parity: forced re-auth).
    expect(await db.all(sql`SELECT * FROM sessions`)).toHaveLength(0);

    const applyAudit = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.apply")).get();
    expect(applyAudit).toBeDefined();
    expect(JSON.parse(applyAudit!.detail!)).toMatchObject({ mode: "replace", includeUsers: true });
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
      await startImportApply(db, job, { mode: "merge", includeUsers: false, actor: ACTOR }, stubLogger);
      throw new Error("expected startImportApply to reject");
    }
    catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    }
  });
});
