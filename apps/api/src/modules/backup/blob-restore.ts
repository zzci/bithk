/**
 * Backup v2 BLOB IMPORT (PLAN-075 R4 + R7 import side, Phase 3).
 *
 * Two consumers share the hash-verify-then-put primitive here:
 *
 * - {@link importArchiveBlobs} — stage 5 of the import pipeline: after the
 *   merge/replace transaction commits, the staged DATA archive is streamed a
 *   second time and every `blobs/<ab>/<cd>/<sha>` entry referenced by a
 *   now-live `files` row is written to the active storage driver
 *   (`exists` → content-addressed skip; sha recomputed while streaming and
 *   the entry is written ONLY on a match). The R7 `expectedBlobs` manifest
 *   list distinguishes "expected in the separate blob archive" from
 *   genuinely-missing blobs.
 * - {@link restoreBlobArchive} — the standalone blob restore (R7): a
 *   `blobs.tar.gz` upload with NO manifest inside (by design), validated
 *   against a blobs-only allowlist + the import caps, imported with the
 *   same exists/verify/put per-entry flow, idempotent by construction.
 *
 * Both finish with {@link unquarantineRestoredFiles} (rows whose bytes just
 * arrived leave quarantine) and the existing `reconcileRestoredFiles`
 * consistency check (still-missing rows get quarantined exactly as v1).
 */
import type { BackupManifestV2 } from "./archive.service";
import type { ImportLimits } from "./import.service";
import type { ReconcileResult } from "./restore.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { FileStorageDriver } from "@/modules/file/storage/types";
import type { Logger } from "@/shared/lib/logger";
import { Buffer } from "node:buffer";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { getActiveDriver } from "@/modules/file/storage/registry";
import { AppError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { getBackupStagingRoot } from "./export-job.service";
import { importLimitsFor, malformedArchiveError, RE_BLOB_ENTRY, stageUpload, walkTarGzEntries } from "./import.service";
import { reconcileRestoredFiles } from "./restore.service";

/**
 * Quarantine sentinel prefix — kept in sync with `restore.service.ts`
 * (which writes `quarantined:backup-restore-missing-blob`) and the file
 * module's `QUARANTINED_DRIVER_PREFIX`. Matched as a prefix so any future
 * quarantine reason heals through the same rescan.
 */
const QUARANTINE_PREFIX = "quarantined:";

// ─── Shared per-entry primitive ──────────────────────────────────────────

async function drainStream(stream: AsyncIterable<Buffer>): Promise<void> {
  for await (const _ of stream)
    void _; // bytes intentionally discarded
}

/**
 * Buffer one blob entry (bounded by the per-blob cap upstream), recompute
 * its sha256 and `put` it ONLY when the hash matches the entry path — the
 * tar path is never trusted as content identity.
 */
async function verifyAndPutBlob(
  driver: FileStorageDriver,
  sha256: string,
  stream: AsyncIterable<Buffer>,
): Promise<"written" | "failed"> {
  const hasher = new Bun.CryptoHasher("sha256");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    hasher.update(chunk);
    chunks.push(chunk);
  }
  if (hasher.digest("hex") !== sha256)
    return "failed";
  const bytes = Buffer.concat(chunks);
  // Copy out of the (possibly pooled) Buffer so the driver sees exactly
  // the blob's bytes, not the surrounding pool slab.
  await driver.put(deriveStorageKey(sha256), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return "written";
}

// ─── Un-quarantine / rescan ──────────────────────────────────────────────

/** Rescan outcome (FIX-062): cheap — only quarantined rows are probed. */
export interface BlobRescanReport {
  /** Quarantined `files` rows probed against the active driver. */
  readonly scanned: number;
  /** Rows whose blob is back — restored to the active driver. */
  readonly healed: number;
  /** Rows still without a backing blob — left quarantined. */
  readonly stillMissing: number;
}

/**
 * Reverse of `reconcileRestoredFiles`'s quarantine: every `files` row on
 * the quarantine sentinel whose blob NOW exists on the active driver is
 * restored to the active driver, with `ref_count` recounted from
 * `file_references`. Runs after every blob import so an apply
 * (which reconciles before blobs arrive) and the standalone blob restore
 * both heal rows whose bytes just arrived — and is exposed directly (FIX-062)
 * as the CLI `backup:blob-rescan` and the admin blob-rescan endpoint, the
 * path-correspondence heal for operators who copy the storage tree AFTER a
 * DB-only import. Scans ONLY quarantined rows, so it is cheap enough to run
 * at the end of every import apply.
 */
export async function rescanQuarantinedFiles(db: AppDatabase, logger?: Logger): Promise<BlobRescanReport> {
  let driver: FileStorageDriver;
  try {
    driver = getActiveDriver();
  }
  catch {
    return { scanned: 0, healed: 0, stillMissing: 0 };
  }
  const rows = await db.all<{ id: string; sha256: string }>(sql`
    SELECT id, sha256 FROM files WHERE storage_driver LIKE ${`${QUARANTINE_PREFIX}%`}
  `);
  let restored = 0;
  for (const row of rows) {
    const key = deriveStorageKey(row.sha256);
    let present = false;
    try {
      present = await driver.exists(key);
    }
    catch {
      present = false;
    }
    if (!present)
      continue;
    try {
      await db.run(sql`
        UPDATE files
        SET storage_driver = ${driver.name},
            storage_key = ${key},
            ref_count = (SELECT COUNT(*) FROM file_references WHERE file_id = files.id)
        WHERE id = ${row.id}
      `);
    }
    catch (err) {
      // UNIQUE(sha256, storage_driver): another live row already serves this
      // content on the active driver — leave this one quarantined.
      logger?.warn(
        { err: err instanceof Error ? err.message : String(err), fileId: row.id },
        "blob restore: could not un-quarantine row; leaving it quarantined",
      );
      continue;
    }
    restored++;
    logger?.info({ fileId: row.id }, "blob restore: backing blob arrived; row un-quarantined");
  }
  return { scanned: rows.length, healed: restored, stillMissing: rows.length - restored };
}

/** Healed-count view of {@link rescanQuarantinedFiles} — the blob-import stages only report this number. */
export async function unquarantineRestoredFiles(db: AppDatabase, logger?: Logger): Promise<number> {
  return (await rescanQuarantinedFiles(db, logger)).healed;
}

// ─── Stage 5: blob import from the staged DATA archive ──────────────────

export interface ArchiveBlobStageReport {
  written: number;
  skippedExisting: number;
  failed: number;
  /** Archive blob entries referenced by no live `files` row (skipped + warned). */
  unreferenced: number;
  /** Expected blobs absent from this archive AND the driver — genuinely missing. */
  missing: number;
  /** Expected blobs awaiting the separate `blobs.tar.gz` (R7, `blobsMode=separate`). */
  expectedInSeparateArchive: number;
}

/**
 * Stream the staged data archive a second time (after the row transaction
 * committed) and import every blob entry referenced by a now-live `files`
 * row. Mutates `warnings` with per-blob findings. Failures never throw —
 * a failed blob leaves its row to reconcile/quarantine.
 */
export async function importArchiveBlobs(
  db: AppDatabase,
  archivePath: string,
  manifest: BackupManifestV2,
  warnings: string[],
  logger?: Logger,
): Promise<ArchiveBlobStageReport> {
  const report: ArchiveBlobStageReport = {
    written: 0,
    skippedExisting: 0,
    failed: 0,
    unreferenced: 0,
    missing: 0,
    expectedInSeparateArchive: 0,
  };

  let driver: FileStorageDriver;
  try {
    driver = getActiveDriver();
  }
  catch {
    if (manifest.tables.some(t => t.name === "files"))
      warnings.push("no active storage driver — blob import skipped");
    return report;
  }

  const liveShaRows = await db.all<{ sha256: string }>(sql`SELECT DISTINCT sha256 FROM files`);
  const liveShas = new Set(liveShaRows.map(r => r.sha256));

  const seen = new Set<string>();
  await walkTarGzEntries(archivePath, async (header, stream) => {
    const match = RE_BLOB_ENTRY.exec(header.name);
    if (!match) {
      // manifest.json / data entries — already validated in stage 1.
      await drainStream(stream);
      return;
    }
    const sha = match[3]!;
    seen.add(sha);
    if (!liveShas.has(sha)) {
      report.unreferenced++;
      warnings.push(`blob ${sha} is referenced by no live files row — skipped`);
      await drainStream(stream);
      return;
    }
    if (await driver.exists(deriveStorageKey(sha))) {
      report.skippedExisting++;
      await drainStream(stream);
      return;
    }
    const outcome = await verifyAndPutBlob(driver, sha, stream);
    if (outcome === "written") {
      report.written++;
    }
    else {
      report.failed++;
      warnings.push(`blob ${sha} content does not match its hash — not imported (row left for reconcile)`);
      logger?.warn({ sha256: sha }, "backup import: blob hash mismatch; entry rejected");
    }
  });

  // R7 accounting: expectedBlobs is the precise expected list across every
  // mode. Expected blobs that this archive did not carry and the driver
  // does not hold are either awaiting the separate blobs.tar.gz
  // (blobsMode=separate) or genuinely missing (embedded/none). Legacy
  // pre-R7 archives have no list — missing-blob detection is then left to
  // reconcile alone.
  if (manifest.expectedBlobs === undefined) {
    if (manifest.tables.some(t => t.name === "files"))
      warnings.push("legacy archive without expectedBlobs — missing blobs are detected by reconcile only");
    return report;
  }
  const expectedShas = new Set(manifest.expectedBlobs.map(b => b.sha256));
  for (const sha of expectedShas) {
    if (seen.has(sha))
      continue;
    if (await driver.exists(deriveStorageKey(sha)))
      continue;
    if (manifest.blobsMode === "separate") {
      report.expectedInSeparateArchive++;
    }
    else if (manifest.blobsMode === "external") {
      // FIX-062 archives never carry bytes — the operator copies the storage
      // tree/bucket; a rescan heals the quarantined rows once the bytes land.
      report.missing++;
      warnings.push(`expected blob ${sha} is not present on the storage backend — copy the storage tree/bucket, then run a blob rescan`);
    }
    else {
      report.missing++;
      warnings.push(`expected blob ${sha} is absent from the archive and the storage driver`);
    }
  }
  if (report.expectedInSeparateArchive > 0)
    warnings.push(`${report.expectedInSeparateArchive} blob(s) are expected in the separate blobs.tar.gz — upload it to /api/backup/v2/blob-restores`);
  return report;
}

// ─── Standalone blob restore (R7) ────────────────────────────────────────

export interface BlobRestoreReport {
  readonly written: number;
  readonly skippedExisting: number;
  readonly failed: number;
  readonly unquarantined: number;
  readonly reconcile: ReconcileResult;
}

/**
 * Validate + import a standalone `blobs.tar.gz` (R7 separate export). The
 * archive carries NO manifest by design; validation is the blobs-only
 * allowlist (exactly `blobs/<ab>/<cd>/<64-hex>` with matching hash prefix,
 * plain file entries only) plus the import caps. Anything else — including
 * a data archive's `manifest.json` / `data/` entries — rejects the WHOLE
 * archive before a single byte is written (two-pass: validate, then
 * import). Idempotent by construction: re-uploading yields all
 * `skippedExisting`.
 */
export async function restoreBlobArchive(
  db: AppDatabase,
  config: Config,
  source: Blob,
  limitOverrides: Partial<ImportLimits> = {},
  logger?: Logger,
): Promise<BlobRestoreReport> {
  const limits = importLimitsFor(config, limitOverrides);
  if (source.size > limits.maxArchiveBytes)
    throw new AppError(`Blob archive exceeds the ${limits.maxArchiveBytes}-byte upload cap`, 400, "ARCHIVE_TOO_LARGE");

  let driver: FileStorageDriver;
  try {
    driver = getActiveDriver();
  }
  catch {
    throw new AppError("No active file storage driver — blobs cannot be restored.", 400, "NO_STORAGE_DRIVER");
  }

  const stagingDir = resolve(getBackupStagingRoot(config), "blob-restores", ulid());
  const archivePath = resolve(stagingDir, "blobs.tar.gz");
  await mkdir(stagingDir, { recursive: true });

  try {
    await stageUpload(source, archivePath, limits.maxArchiveBytes);

    // Pass 1 — validate every entry against the blobs-only allowlist and
    // the caps WITHOUT writing anything, so a poisoned archive is rejected
    // wholesale before the first put.
    let entryCount = 0;
    let decompressedBytes = 0;
    const seen = new Set<string>();
    await walkTarGzEntries(archivePath, async (header, stream) => {
      entryCount++;
      if (entryCount > limits.maxEntries)
        throw new AppError(`Archive exceeds the ${limits.maxEntries}-entry cap`, 400, "ARCHIVE_TOO_LARGE");
      if (header.type !== undefined && header.type !== "file")
        throw malformedArchiveError(`unsupported entry type '${header.type}' (${header.name})`);
      // Cross-endpoint hint: a data archive belongs on the import endpoint.
      if (header.name === "manifest.json" || header.name.startsWith("data/"))
        throw malformedArchiveError("this is a data backup archive — upload it to /api/backup/v2/imports instead");
      const match = RE_BLOB_ENTRY.exec(header.name);
      if (!match)
        throw malformedArchiveError(`entry path outside the blobs allowlist: ${header.name}`);
      const [, ab, cd, sha] = match;
      if (sha!.slice(0, 2) !== ab || sha!.slice(2, 4) !== cd)
        throw malformedArchiveError(`blob entry path prefix does not match its hash (${header.name})`);
      if (seen.has(sha!))
        throw malformedArchiveError(`duplicate entry ${header.name}`);
      seen.add(sha!);
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        decompressedBytes += chunk.length;
        if (size > limits.maxBlobBytes)
          throw new AppError(`Blob ${sha} exceeds the per-blob size cap`, 400, "ARCHIVE_TOO_LARGE");
        if (decompressedBytes > limits.maxDecompressedBytes)
          throw new AppError("Archive decompresses past the total size cap", 400, "ARCHIVE_TOO_LARGE");
      }
    });
    if (entryCount === 0)
      throw malformedArchiveError("archive contains no blob entries");

    // Pass 2 — import: exists → skip; else verify sha while streaming and
    // put on match.
    let written = 0;
    let skippedExisting = 0;
    let failed = 0;
    await walkTarGzEntries(archivePath, async (header, stream) => {
      const sha = RE_BLOB_ENTRY.exec(header.name)![3]!;
      if (await driver.exists(deriveStorageKey(sha))) {
        skippedExisting++;
        await drainStream(stream);
        return;
      }
      const outcome = await verifyAndPutBlob(driver, sha, stream);
      if (outcome === "written") {
        written++;
      }
      else {
        failed++;
        logger?.warn({ sha256: sha }, "blob restore: blob hash mismatch; entry rejected");
      }
    });

    const unquarantined = await unquarantineRestoredFiles(db, logger);
    const reconcile = await reconcileRestoredFiles(db, logger);
    return { written, skippedExisting, failed, unquarantined, reconcile };
  }
  finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
