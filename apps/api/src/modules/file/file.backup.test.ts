import type { AppDatabase } from "@/db";
/**
 * Rule 14 (PLAN-075): the file module's built-in import transform. `files`
 * is content-addressed per driver, so an incoming row whose PK is new but
 * whose `(sha256, storageDriver)` already exists live is skipped as a
 * duplicate (flagged `remapped`) and incoming `file_references.fileId`
 * values are redirected onto the existing live id.
 */
import type { BackupManifestV2, ManifestColumn, ManifestTable } from "@/modules/backup/archive.service";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { runImportDryRun, runImportMerge } from "@/modules/backup/import-mapping";
import { __resetBackupRegistryForTests, getDataModules, registerBackupContribution } from "@/modules/backup/registry";
import { seedUser, testNanoid } from "@/shared/test/route-harness";
import { fileBackupContribution } from "./file.backup";
import { fileReferences, files } from "./schema";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let userId: string;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-file-backup-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(fileBackupContribution);
  userId = await seedUser(db, "admin");
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

function col(name: string, type = "text", notNull = true, extra: Partial<ManifestColumn> = {}): ManifestColumn {
  return { name, type, notNull, ...extra };
}

function mTable(name: string, columns: ManifestColumn[]): ManifestTable {
  return { name, module: "files", file: `data/${name}.ndjson`, rowCount: 0, primaryKey: ["id"], columns };
}

function manifest(): BackupManifestV2 {
  return {
    format: "bithk-backup",
    formatVersion: 2,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: { lastIdx: 0, lastTag: "0000_test", entryCount: 1 } },
    redacted: false,
    includeBlobs: false,
    blobsMode: "none",
    modules: [{ name: "files", deps: [] }],
    tables: [
      mTable("files", [
        col("id"),
        col("sha256"),
        col("size", "integer"),
        col("mimetype"),
        col("storageDriver"),
        col("storageKey"),
        col("refCount", "integer", true, { hasDefault: true }),
        col("uploadedBy", "text", true, { references: "users.id" }),
      ]),
      mTable("file_references", [
        col("id"),
        col("fileId", "text", true, { references: "files.id" }),
        col("ownerType"),
        col("ownerId"),
        col("filename"),
        col("metadata", "text", true, { hasDefault: true }),
        col("createdBy", "text", true, { references: "users.id" }),
        col("createdAt", "text", true, { hasDefault: true }),
      ]),
    ],
    blobs: { count: 0, totalBytes: 0 },
    warnings: [],
  };
}

const SHA_LIVE = "ab".repeat(32);
const SHA_NEW = "cd".repeat(32);

function fileRow(id: string, sha256: string): Record<string, unknown> {
  return {
    id,
    sha256,
    size: 4,
    mimetype: "application/octet-stream",
    storageDriver: "local",
    storageKey: `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
    refCount: 1,
    uploadedBy: userId,
  };
}

function refRow(id: string, fileId: string, ownerId: string): Record<string, unknown> {
  return {
    id,
    fileId,
    ownerType: "item_attachment",
    ownerId,
    filename: "doc.bin",
    metadata: "{}",
    createdBy: userId,
    createdAt: "2026-06-01T00:00:00.000Z",
  };
}

async function seedLiveFile(id: string, sha256: string, refCount = 0): Promise<void> {
  await db.insert(files).values({
    id,
    sha256,
    size: 4,
    mimetype: "application/octet-stream",
    storageDriver: "local",
    storageKey: `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
    refCount,
    uploadedBy: userId,
  }).run();
}

async function seedLiveRef(id: string, fileId: string): Promise<void> {
  await db.insert(fileReferences).values({
    id,
    fileId,
    ownerType: "item_attachment",
    ownerId: `owner-${id}`,
    filename: "doc.bin",
    metadata: "{}",
    createdBy: userId,
    createdAt: "2026-06-01T00:00:00.000Z",
  }).run();
}

async function refCounts(): Promise<{ id: string; refCount: number }[]> {
  const rows = await db.select({ id: files.id, refCount: files.refCount }).from(files).all();
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

describe("file backup contribution", () => {
  test("registers FK-safe tables, deps, and the rule-14 transforms", () => {
    const mod = getDataModules().files;
    expect(mod?.tables.map(table => getTableName(table))).toEqual(["files", "file_references"]);
    expect(mod?.deps).toEqual(["users"]);
    expect(mod?.importTransforms?.map(t => t.fromTable)).toEqual(["files", "file_references"]);
  });
});

describe("rule 14: files sha-remap", () => {
  test("new PK with live (sha256, storageDriver) skips the row flagged remapped and redirects references", async () => {
    await seedLiveFile("f1existing", SHA_LIVE);

    const tables = new Map([
      ["files", [fileRow("f2incoming", SHA_LIVE)]],
      ["file_references", [refRow("r1aaaaaa", "f2incoming", "owner-1")]],
    ]);

    const report = runImportMerge(db, manifest(), tables);

    const filesReport = report.tables.files!;
    expect(filesReport.skippedDuplicate).toBe(1);
    expect(filesReport.remapped).toBe(1);
    expect(filesReport.inserted).toBe(0);
    expect(filesReport.transformed).toBe(0); // same-table transform — not a re-home
    expect(report.tables.file_references!.inserted).toBe(1);
    expect(report.totals.failed).toBe(0);

    // The reference landed on the EXISTING live file id, not the archive id.
    const refs = await db.select({ fileId: fileReferences.fileId }).from(fileReferences).all();
    expect(refs).toEqual([{ fileId: "f1existing" }]);
    const allFiles = await db.select({ id: files.id }).from(files).all();
    expect(allFiles).toEqual([{ id: "f1existing" }]);
  });

  test("new content passes through untouched; existing PK stays a plain rule-11 skip", async () => {
    await seedLiveFile("f1existing", SHA_LIVE);

    const tables = new Map([
      ["files", [fileRow("f1existing", SHA_LIVE), fileRow("f3new4444", SHA_NEW)]],
      ["file_references", [refRow("r2aaaaaa", "f3new4444", "owner-2")]],
    ]);

    const report = runImportMerge(db, manifest(), tables);

    const filesReport = report.tables.files!;
    expect(filesReport.skippedDuplicate).toBe(1); // f1existing via PK probe
    expect(filesReport.remapped).toBeUndefined();
    expect(filesReport.inserted).toBe(1); // f3new4444
    expect(report.tables.file_references!.inserted).toBe(1);

    const refs = await db.select({ fileId: fileReferences.fileId }).from(fileReferences).all();
    expect(refs).toEqual([{ fileId: "f3new4444" }]);
  });

  test("dry-run report equals the apply report and leaves no trace", async () => {
    await seedLiveFile("f1existing", SHA_LIVE);
    const tables = new Map([
      ["files", [fileRow("f2incoming", SHA_LIVE), fileRow("f3new4444", SHA_NEW)]],
      ["file_references", [refRow("r1aaaaaa", "f2incoming", "owner-1"), refRow("r2aaaaaa", "f3new4444", "owner-2")]],
    ]);

    const dryRun = runImportDryRun(db, manifest(), tables);
    expect(await db.select({ id: files.id }).from(files).all()).toEqual([{ id: "f1existing" }]);
    expect(await db.select().from(fileReferences).all()).toEqual([]);

    const applied = runImportMerge(db, manifest(), tables);
    expect({ ...dryRun, dryRun: undefined }).toEqual({ ...applied, dryRun: undefined });
    expect(applied.tables.files!.remapped).toBe(1);
    expect(applied.tables.files!.inserted).toBe(1);

    const refs = await db.select({ id: fileReferences.id, fileId: fileReferences.fileId }).from(fileReferences).all();
    expect(refs.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "r1aaaaaa", fileId: "f1existing" },
      { id: "r2aaaaaa", fileId: "f3new4444" },
    ]);
  });
});

describe("files.ref_count recount after merge import", () => {
  test("rule-14 remap target's ref_count includes the remapped references", async () => {
    await seedLiveFile("f1existing", SHA_LIVE, 1);
    await seedLiveRef("r0aaaaaa", "f1existing");

    const tables = new Map([
      ["files", [fileRow("f2incoming", SHA_LIVE)]],
      ["file_references", [refRow("r1aaaaaa", "f2incoming", "owner-1")]],
    ]);

    // The dry-run recounts inside its transaction, then rolls back.
    runImportDryRun(db, manifest(), tables);
    expect(await refCounts()).toEqual([{ id: "f1existing", refCount: 1 }]);

    runImportMerge(db, manifest(), tables);
    expect(await refCounts()).toEqual([{ id: "f1existing", refCount: 2 }]);
  });

  test("references inserted against an already-live file (no remap) bump its ref_count", async () => {
    await seedLiveFile("f1existing", SHA_LIVE);

    const tables = new Map([
      ["files", []],
      ["file_references", [refRow("r1aaaaaa", "f1existing", "owner-1")]],
    ]);

    runImportMerge(db, manifest(), tables);
    expect(await refCounts()).toEqual([{ id: "f1existing", refCount: 1 }]);
  });

  test("inserted files row whose references were partially skipped gets the live count, not the archive value", async () => {
    await seedLiveFile("f1existing", SHA_LIVE, 1);
    await seedLiveRef("r1aaaaaa", "f1existing");

    const tables = new Map([
      ["files", [{ ...fileRow("f3new4444", SHA_NEW), refCount: 2 }]],
      ["file_references", [
        refRow("r1aaaaaa", "f3new4444", "owner-2"), // PK collides with the live ref — duplicate skip
        refRow("r2aaaaaa", "f3new4444", "owner-3"),
      ]],
    ]);

    const report = runImportMerge(db, manifest(), tables);
    expect(report.tables.file_references!.skippedDuplicate).toBe(1);
    expect(report.tables.file_references!.inserted).toBe(1);
    expect(await refCounts()).toEqual([
      { id: "f1existing", refCount: 1 },
      { id: "f3new4444", refCount: 1 }, // archive said 2; only one reference landed
    ]);
  });
});
