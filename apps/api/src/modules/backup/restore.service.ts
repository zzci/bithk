/**
 * Backup import guards + post-restore reconciliation (v2 dependencies).
 *
 * `assertSane` / `assertIdShape` and the row caps bound every archive row the
 * v2 importer accepts; `reconcileRestoredFiles` runs after an apply.
 *
 * SCOPE CAVEAT: file blob bytes are **out of backup scope**. A backup never
 * carries the objects behind `files` rows; it only replays the rows. After a
 * restore onto a deployment whose storage backend does not already hold
 * those blobs, the `files` / `file_references` rows would point at absent
 * objects and every download would 500.
 *
 * {@link reconcileRestoredFiles} runs post-restore: it asks the active
 * storage driver whether each restored `files` blob actually exists and
 * **quarantines** (does not delete) the rows whose backing object is gone,
 * so a restored deployment fails loudly/visibly (a clean 404 on download
 * via the existing `FILE_BACKEND_MISMATCH` path) instead of 500ing — and
 * the operator keeps the row for diagnosis.
 *
 * The v1 JSON importer that used to live here was removed in CHORE-013
 * (routes in FIX-072).
 */
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { sql } from "drizzle-orm";
import { getActiveDriver } from "@/modules/file/storage/registry";
import { AppError } from "@/shared/lib/errors";

/**
 * Sentinel written into `files.storage_driver` for a quarantined row. It
 * can never equal a real driver name, so `buildDownloadResponse`'s
 * `driver.name !== file.storage_driver` guard turns every download attempt
 * into the existing clean `404 FILE_BACKEND_MISMATCH` instead of a 500 — and
 * the unreferenced-files GC's identical guard refuses to touch the row, so
 * the quarantine is non-destructive.
 */
const QUARANTINE_DRIVER = "quarantined:backup-restore-missing-blob";

export interface ReconcileResult {
  /** `files` rows inspected (those still on a real, active driver). */
  readonly checked: number;
  /** `files` rows quarantined because their blob was absent on the backend. */
  readonly quarantined: number;
}

/**
 * Hard caps to bound an admin-supplied backup. A 50 MB JSON can otherwise
 * contain millions of rows of one table; a single SQLite transaction holding
 * that long would lock writes process-wide. The numbers are conservative —
 * legitimate exports for the use cases this template targets stay well below.
 */
export const MAX_TOTAL_ROWS = 1_000_000;
export const MAX_ROWS_PER_TABLE = 500_000;
const MAX_STRING_LENGTH = 1_000_000;
const MAX_OBJECT_DEPTH = 16;

/**
 * Walk a parsed JSON tree and reject pathological shapes (unbounded
 * recursion / megabyte strings) before we hand the rows to drizzle.
 */
export function assertSane(value: unknown, depth = 0): void {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new AppError("Backup nesting too deep", 400, "INVALID_BACKUP_ROW");
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH)
      throw new AppError("Backup contains an oversized string field", 400, "INVALID_BACKUP_ROW");
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) assertSane(v, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) assertSane(v, depth + 1);
  }
}

// Identifier alphabet covers nanoid (8 chars) and session ids (64-char hex).
// Both are URL-safe / base62-style. Reject anything carrying control chars,
// path separators, or quotes.
const RE_SAFE_ID = /^[\w-]{1,128}$/;

/**
 * Validate id-like fields (where present) match the URL-safe id alphabet
 * so a malicious backup cannot smuggle SQL-meta or path-traversal payloads
 * through `id` / FK columns that we later interpolate into filesystem
 * paths or audit messages.
 */
export function assertIdShape(row: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(row)) {
    // Empty string is a "no reference" sentinel (e.g. `drive_entries`'
    // `parent_entry_id = ""` for root entries) — treat it like null/absent.
    if (v === null || v === undefined || typeof v !== "string" || v === "")
      continue;
    if (k === "id" || k.endsWith("Id") || k.endsWith("_id")) {
      if (!RE_SAFE_ID.test(v))
        throw new AppError(`Invalid id format on field ${k}`, 400, "INVALID_BACKUP_ROW");
    }
  }
}

/**
 * Post-restore reconciliation for the blob-out-of-scope caveat.
 *
 * Walks every `files` row whose `storage_driver` matches the active driver
 * and asks the driver whether the backing object exists. Rows whose blob is
 * absent are **quarantined** — `storage_driver` is rewritten to
 * {@link QUARANTINE_DRIVER} and `ref_count` is zeroed — not deleted: the row
 * survives for operator diagnosis, every download deterministically returns
 * the existing clean `404 FILE_BACKEND_MISMATCH`, and the unreferenced-files
 * GC skips it (its `driver.name !== storage_driver` guard).
 *
 * Rows already on a different/inactive driver are left untouched (the same
 * pre-existing `FILE_BACKEND_MISMATCH` path already covers them); only rows
 * the active driver *should* be able to serve are verified.
 *
 * Exported so the restore flow and tests can invoke it directly. Throws
 * nothing — a backend probe failure is treated as "blob missing" so the
 * restore degrades safely to the loud path rather than masking the leak.
 */
export async function reconcileRestoredFiles(db: AppDatabase, logger?: Logger): Promise<ReconcileResult> {
  let driverName: string;
  let driver: { exists: (key: string) => Promise<boolean> };
  try {
    const d = getActiveDriver();
    driverName = d.name;
    driver = d;
  }
  catch {
    // No active driver selected (e.g. a restore harness with the file
    // module uninitialised). Nothing we can verify; leave rows as-is.
    return { checked: 0, quarantined: 0 };
  }

  const rows = await db.all<{ id: string; storage_key: string }>(sql`
    SELECT id, storage_key FROM files WHERE storage_driver = ${driverName}
  `);

  let quarantined = 0;
  for (const row of rows) {
    let present: boolean;
    try {
      present = await driver.exists(row.storage_key);
    }
    catch (err) {
      // Treat an unreadable backend as missing: fail loud, never silently
      // serve a row we could not verify.
      present = false;
      logger?.warn(
        { err: err instanceof Error ? err.message : String(err), fileId: row.id },
        "restore reconciliation: storage existence probe failed; quarantining",
      );
    }
    if (present)
      continue;

    await db.run(sql`
      UPDATE files
      SET storage_driver = ${QUARANTINE_DRIVER}, ref_count = 0
      WHERE id = ${row.id}
    `);
    quarantined++;
    logger?.warn(
      { fileId: row.id, storageKey: row.storage_key },
      "restore reconciliation: backing blob absent on storage backend; row quarantined (downloads will 404, not 500)",
    );
  }

  if (quarantined > 0) {
    logger?.error(
      { checked: rows.length, quarantined },
      "restore reconciliation: file blobs are out of backup scope and some restored rows have no backing object; quarantined them — re-seed the storage backend or accept the loss",
    );
  }

  return { checked: rows.length, quarantined };
}
