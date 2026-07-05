/**
 * Backup v2 APPLY orchestration (PLAN-075 R3/R4/R6, Phase 3).
 *
 * {@link startImportApply} drives a staged, `validated` import job through:
 *
 *     validated ─► applying ─► completed (final report)
 *                      │
 *                      ▼
 *                   failed (error)
 *
 * Guards (all BEFORE the job flips to `applying`, so a refused apply leaves
 * the job retryable):
 *
 * - state machine: only `validated` applies; re-applying a completed /
 *   failed job is refused (409) — a re-run of a completed merge would be a
 *   no-op by construction, but is refused for clarity per the plan;
 * - process-wide one-applying-at-a-time guard (409, mirrors the export-job
 *   semaphore's WAL-pressure rationale);
 * - replace mode preflight: archive schema journal position must EQUAL the
 *   live journal position (tolerant mapping plus wholesale deletion is too
 *   dangerous to combine), plus the v1 guards verbatim — `includeUsers`
 *   handling, admin lock-out refusal, user-FK pre-flight. (The guard logic
 *   is replicated from `restore.routes.ts`, which stays untouched for v1.)
 * - wipe-before-merge preflight (FIX-061): archive must contain an active
 *   admin; a web actor must match one by id OR email/oauthSub. Runs before
 *   the state flips — and therefore before any deletion.
 *
 * Apply modes:
 *
 * - `merge` — the Phase-2 mapping engine's row loop in a COMMITTED
 *   synchronous transaction (`runImportMerge`); per-row semantics and
 *   report keys identical to the dry-run.
 * - `replace` — delegates to the v1 `importJsonBackup` engine
 *   (delete-then-insert) fed from the archive's parsed NDJSON tables, then
 *   replays the v1 post-import behavior: session revocation on role/status
 *   change and per-user `user.restored` audit rows.
 *
 * After the row stage, both modes run the blob stage (stream the staged
 * archive again, import referenced blobs), un-quarantine rows whose bytes
 * arrived, and finish with `reconcileRestoredFiles`. The final report and
 * the `backup.import.apply` audit (critical: a failed audit write fails the
 * apply) land on the job for the poll route.
 */
import type { ArchiveBlobStageReport } from "./blob-restore";
import type { BackupData } from "./export.service";
import type { ImportTableReport } from "./import-mapping";
import type { ImportJob } from "./import.service";
import type { ReconcileResult } from "./restore.service";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteUserSessions } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { audit } from "@/modules/audit/audit.service";
import { ROOT_DIR } from "@/root";
import { AppError } from "@/shared/lib/errors";
import { importArchiveBlobs, unquarantineRestoredFiles } from "./blob-restore";
import { runImportMerge } from "./import-mapping";
import { importJsonBackup, reconcileRestoredFiles } from "./restore.service";

export type ImportApplyMode = "merge" | "replace";

/** Actor context captured at the route — audits are written async. */
export interface ImportApplyActor {
  readonly id: string;
  readonly name: string;
  readonly ip: string;
  readonly userAgent: string;
}

export interface ImportApplyOptions {
  readonly mode: ImportApplyMode;
  /** Replace mode only (v1 semantics); merge always inserts what it can. */
  readonly includeUsers: boolean;
  /**
   * Merge mode only (FIX-061): delete ALL registry rows (children first) in
   * the same transaction before the merge loop, so the import cannot
   * conflict. Guarded by {@link prepareWipe} BEFORE any deletion.
   */
  readonly wipeExisting?: boolean;
  readonly actor: ImportApplyActor;
}

export interface ImportApplyReport {
  readonly dryRun: false;
  readonly mode: ImportApplyMode;
  /** Merge mode: identical keys/counts to the dry-run report. Empty for replace. */
  readonly tables: Record<string, ImportTableReport>;
  readonly skippedTables: string[];
  readonly skippedModules: string[];
  readonly warnings: string[];
  readonly totals: { inserted: number; skippedDuplicate: number; failed: number; transformed: number };
  /** Replace mode only — the v1 engine's coarse counters. */
  readonly replace?: { tablesImported: number; rowsImported: number; includeUsers: boolean };
  /** Merge + wipeExisting only (FIX-061) — per-table deleted-row counts. */
  readonly wipe?: { tables: Record<string, number>; total: number };
  readonly blobs: ArchiveBlobStageReport;
  readonly reconcile: ReconcileResult;
}

// ─── Process-wide one-applying-at-a-time guard ───────────────────────────

let applyingJobId: string | undefined;

/** Test-only: clear the applying guard. */
export function __resetImportApplyForTests(): void {
  applyingJobId = undefined;
}

// ─── Live schema journal (replace-mode schema gate) ──────────────────────

/**
 * Read the live drizzle migration journal position. Mirrors the archive
 * writer's `readSchemaJournal` (private in `archive.service.ts`): packaged
 * releases ship `drizzle/` at the artifact root, dev runs read
 * `apps/api/drizzle/`.
 */
export function readLiveSchemaJournal(): { lastIdx: number; lastTag: string; entryCount: number } {
  const packaged = resolve(ROOT_DIR, "drizzle/meta/_journal.json");
  const journalPath = existsSync(packaged) ? packaged : resolve(ROOT_DIR, "apps/api/drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number; tag: string }[] };
  const last = journal.entries[journal.entries.length - 1];
  return {
    lastIdx: last?.idx ?? -1,
    lastTag: last?.tag ?? "",
    entryCount: journal.entries.length,
  };
}

// ─── v1 replace guards (replicated verbatim from restore.routes.ts) ──────

const USER_TABLES = ["users", "groups", "user_preferences"] as const;

interface UserRowLike {
  readonly id: string;
  readonly role?: string;
  readonly status?: string;
}

/**
 * When the operator chooses `includeUsers=false`, the user table is left
 * intact but other tables still reference user ids via FK. Pre-flight scan:
 * collect every known user-FK value in the imported rows and confirm a
 * matching user exists in the live DB — a useful error instead of a
 * COMMIT-time "FOREIGN KEY constraint failed".
 */
async function assertUserFkIntegrity(
  liveUserIds: ReadonlySet<string>,
  backupTables: Record<string, unknown[]>,
): Promise<void> {
  const userFkColumns = new Set([
    "creatorId",
    "creator_id",
    "uploadedBy",
    "uploaded_by",
    "actorId",
    "actor_id",
    "userId",
    "user_id",
    "assigneeId",
    "assignee_id",
    "authorId",
    "author_id",
  ]);

  const referenced = new Set<string>();
  for (const rows of Object.values(backupTables)) {
    if (!Array.isArray(rows))
      continue;
    for (const row of rows) {
      if (!row || typeof row !== "object")
        continue;
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        if (userFkColumns.has(k) && typeof v === "string" && v.length > 0)
          referenced.add(v);
      }
    }
  }
  const missing = [...referenced].filter(id => !liveUserIds.has(id));
  if (missing.length > 0) {
    throw new AppError(
      `Restore would orphan ${missing.length} foreign key reference(s) to users that aren't in the current DB. Re-run with includeUsers=true or restore from a backup that contains the matching users.`,
      400,
      "RESTORE_FK_MISSING_USERS",
    );
  }
}

/** Drop the user-related tables from the parsed backup (shallow copy). */
function stripUserTables<T extends { tables: Record<string, unknown[]>; modules: string[] }>(data: T): T {
  const tables = { ...data.tables };
  for (const t of USER_TABLES)
    delete tables[t];
  const modules = data.modules.filter(m => m !== "users");
  return { ...data, tables, modules };
}

interface ReplacePlan {
  readonly effectiveData: BackupData;
  readonly importedUserRows: readonly UserRowLike[];
  readonly liveById: ReadonlyMap<string, UserRowLike>;
}

async function prepareReplace(db: AppDatabase, job: ImportJob, opts: ImportApplyOptions): Promise<ReplacePlan> {
  // No cross-schema replace: the archive must have been produced at the
  // exact live migration position — tolerant mapping plus wholesale
  // deletion is too dangerous to combine.
  const live = readLiveSchemaJournal();
  const archive = job.manifest.schema.journal;
  if (archive.lastIdx !== live.lastIdx || archive.lastTag !== live.lastTag || archive.entryCount !== live.entryCount) {
    throw new AppError(
      `Replace mode requires the archive schema to match the live schema (archive at migration ${archive.lastTag || "(none)"}, live at ${live.lastTag || "(none)"}). Use merge mode for cross-schema imports.`,
      400,
      "REPLACE_SCHEMA_MISMATCH",
    );
  }

  // Feed the v1 delete-then-insert engine from the archive's parsed NDJSON.
  const data: BackupData = {
    version: 1,
    exportedAt: job.manifest.exportedAt,
    modules: job.manifest.modules.map(m => m.name),
    tables: Object.fromEntries([...job.tables].map(([name, rows]) => [name, rows.map(r => ({ ...r }))])),
  };

  // Snapshot live users to detect role/status changes after the restore
  // (forced session revocation, v1 parity).
  const liveUsers: UserRowLike[] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .all();
  const liveById = new Map(liveUsers.map(u => [u.id, u]));

  let effectiveData = data;
  let importedUserRows: UserRowLike[] = [];

  if (!opts.includeUsers) {
    effectiveData = stripUserTables(data);
    const liveIds = new Set(liveUsers.map(u => u.id));
    await assertUserFkIntegrity(liveIds, effectiveData.tables);
  }
  else {
    const incoming = (data.tables.users ?? []) as unknown as UserRowLike[];
    // Refuse if the applying admin would be locked out: their row must be
    // present, admin, and active.
    const me = incoming.find(r => r.id === opts.actor.id);
    if (!me || me.role !== "admin" || (me.status !== undefined && me.status !== "active")) {
      throw new AppError(
        "Restore would lock out the importing admin",
        400,
        "RESTORE_WOULD_LOCK_OUT",
      );
    }
    importedUserRows = incoming;
  }

  return { effectiveData, importedUserRows, liveById };
}

// ─── Wipe-before-merge preflight (FIX-061) ───────────────────────────────

interface WipeUserSnapshot {
  readonly id: string;
  readonly oauthSub: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
}

interface WipePlan {
  /** Pre-wipe live users — v1-parity session-revocation snapshot. */
  readonly liveUsers: readonly WipeUserSnapshot[];
}

interface ArchiveUserRow {
  readonly id?: unknown;
  readonly oauthSub?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
  readonly status?: unknown;
  readonly isVirtual?: unknown;
}

/**
 * An archive user row that can hold the instance after the wipe: an admin
 * whose status is active (or absent, v1-guard parity) and who is not a
 * virtual user (virtual users cannot log in).
 */
function isActiveAdminRow(row: ArchiveUserRow): boolean {
  return row.role === "admin"
    && (row.status === undefined || row.status === "active")
    && !row.isVirtual;
}

/**
 * Lockout guard + session-revocation snapshot for wipe-before-merge. Runs
 * BEFORE the job flips to `applying` — and therefore before any deletion:
 *
 * - the archive must contain at least one active admin (otherwise the wipe
 *   would leave an instance nobody can administer);
 * - a WEB actor (a live users row) must additionally match an active-admin
 *   archive row by id OR email/oauthSub — cross-instance archives carry the
 *   same person under a different id. A synthetic CLI actor has no live row
 *   and only needs the at-least-one-active-admin check.
 */
async function prepareWipe(db: AppDatabase, job: ImportJob, opts: ImportApplyOptions): Promise<WipePlan> {
  const incoming = (job.tables.get("users") ?? []) as readonly ArchiveUserRow[];
  if (!incoming.some(isActiveAdminRow)) {
    throw new AppError(
      "Wipe-before-merge would leave no active admin: the archive contains none.",
      400,
      "WIPE_WOULD_LOCK_OUT",
    );
  }

  const liveUsers: WipeUserSnapshot[] = await db
    .select({ id: users.id, oauthSub: users.oauthSub, email: users.email, role: users.role, status: users.status })
    .from(users)
    .all();

  const liveActor = liveUsers.find(u => u.id === opts.actor.id);
  if (liveActor) {
    const me = incoming.find(r => r.id === liveActor.id)
      ?? incoming.find(r => r.oauthSub === liveActor.oauthSub || r.email === liveActor.email);
    if (!me || !isActiveAdminRow(me)) {
      throw new AppError(
        "Wipe-before-merge would lock out the importing admin: no active admin row in the archive matches your id, email, or OAuth subject.",
        400,
        "WIPE_WOULD_LOCK_OUT",
      );
    }
  }

  return { liveUsers };
}

// ─── Apply orchestration ─────────────────────────────────────────────────

/**
 * Validate the apply request (state machine + applying guard + replace
 * preflight), flip the job to `applying`, and kick the background runner.
 * Returns once the runner is started; the result arrives via the poll
 * route (`completed` + `job.result` | `failed` + `job.error`). Tests can
 * `await job.done`.
 */
export async function startImportApply(
  db: AppDatabase,
  job: ImportJob,
  opts: ImportApplyOptions,
  logger: Logger,
): Promise<void> {
  if (applyingJobId !== undefined || job.state === "applying")
    throw new AppError("Another import apply is already in progress.", 409, "IMPORT_APPLY_IN_PROGRESS");
  if (job.state !== "validated") {
    throw new AppError(
      `This import has already been applied (state: ${job.state}). Upload the archive again to re-import.`,
      409,
      "IMPORT_ALREADY_APPLIED",
    );
  }

  if (opts.wipeExisting === true && opts.mode !== "merge") {
    throw new AppError(
      "wipeExisting is only valid with merge mode (replace already deletes live tables).",
      400,
      "INVALID_APPLY_MODE",
    );
  }

  // Replace / wipe preflights run BEFORE the state flips, so a refused apply
  // (schema mismatch, lock-out, FK pre-flight) leaves the job `validated` —
  // and, for wipe, before any deletion.
  const replacePlan = opts.mode === "replace" ? await prepareReplace(db, job, opts) : undefined;
  const wipePlan = opts.wipeExisting === true ? await prepareWipe(db, job, opts) : undefined;

  applyingJobId = job.id;
  job.state = "applying";
  job.done = runApply(db, job, opts, replacePlan, wipePlan, logger).finally(() => {
    applyingJobId = undefined;
  });
}

async function runApply(
  db: AppDatabase,
  job: ImportJob,
  opts: ImportApplyOptions,
  replacePlan: ReplacePlan | undefined,
  wipePlan: WipePlan | undefined,
  logger: Logger,
): Promise<void> {
  try {
    const warnings: string[] = [];
    let engine: ReturnType<typeof runImportMerge> | undefined;
    let replaceResult: { tablesImported: number; rowsImported: number } | undefined;

    if (opts.mode === "merge") {
      // One committed synchronous transaction — an unexpected mid-apply
      // failure aborts it atomically (no partial table writes). With
      // wipeExisting the wipe runs INSIDE that transaction, so a failed
      // merge rolls the wipe back too (no data loss on failure).
      engine = runImportMerge(db, job.manifest, job.tables, { wipeExisting: wipePlan !== undefined });
      warnings.push(...engine.warnings);

      if (wipePlan) {
        // v1-parity session revocation against the pre-wipe snapshot: a
        // pre-wipe user keeps their sessions only when the archive restored
        // them under the SAME id with the same role/status. Matching falls
        // back to email/oauthSub for cross-instance archives (a different id
        // means the old sessions are dangling anyway). Today the sessions FK
        // cascade already removes every session when `users` is wiped, so
        // this pass is a belt-and-suspenders parity guarantee.
        const archiveUsers = (job.tables.get("users") ?? []) as readonly ArchiveUserRow[];
        for (const before of wipePlan.liveUsers) {
          const after = archiveUsers.find(r => r.id === before.id)
            ?? archiveUsers.find(r => r.oauthSub === before.oauthSub || r.email === before.email);
          if (!after || after.id !== before.id || after.role !== before.role || after.status !== before.status)
            await deleteUserSessions(db, before.id);
        }
      }
    }
    else {
      const plan = replacePlan!;
      replaceResult = await importJsonBackup(db, plan.effectiveData, logger);

      if (opts.includeUsers) {
        // v1 parity: force-revoke sessions for any user whose role or
        // status changed (or who did not exist live before the restore).
        const changedIds: string[] = [];
        for (const row of plan.importedUserRows) {
          const before = plan.liveById.get(row.id);
          if (!before || before.role !== row.role || before.status !== row.status)
            changedIds.push(row.id);
        }
        for (const uid of changedIds)
          await deleteUserSessions(db, uid);

        // Per-row audit entries so the log captures each restored user.
        for (const row of plan.importedUserRows) {
          await audit(db, logger, {
            actorId: opts.actor.id,
            actorName: opts.actor.name,
            action: "user.restored",
            resourceType: "user",
            resourceId: row.id,
            resourceName: row.id,
            ip: opts.actor.ip,
            userAgent: opts.actor.userAgent,
            result: "success",
          }, { critical: true });
        }
      }
    }

    // Stage 5–6: blob import from the staged archive, un-quarantine rows
    // whose bytes arrived (replace mode reconciled before blobs existed),
    // then the final reconcile pass.
    const blobs = await importArchiveBlobs(db, job.archivePath, job.manifest, warnings, logger);
    const unquarantined = await unquarantineRestoredFiles(db, logger);
    if (unquarantined > 0)
      warnings.push(`${unquarantined} quarantined files row(s) un-quarantined after blob import`);
    const reconcile = await reconcileRestoredFiles(db, logger);

    const report: ImportApplyReport = {
      dryRun: false,
      mode: opts.mode,
      tables: engine?.tables ?? {},
      skippedTables: engine?.skippedTables ?? [],
      skippedModules: engine?.skippedModules ?? [],
      warnings,
      totals: engine?.totals
        ?? { inserted: replaceResult?.rowsImported ?? 0, skippedDuplicate: 0, failed: 0, transformed: 0 },
      ...(replaceResult ? { replace: { ...replaceResult, includeUsers: opts.includeUsers } } : {}),
      ...(engine?.wipe ? { wipe: engine.wipe } : {}),
      blobs,
      reconcile,
    };

    // Critical (v1 pattern): a failed audit write fails the apply — the job
    // reports `failed` even though the rows committed, exactly as loudly as
    // v1's post-commit audit failure.
    await audit(db, logger, {
      actorId: opts.actor.id,
      actorName: opts.actor.name,
      action: "backup.import.apply",
      resourceType: "system",
      resourceId: "database",
      resourceName: "database-backup-import",
      detail: {
        importId: job.id,
        mode: opts.mode,
        includeUsers: opts.includeUsers,
        modules: job.manifest.modules.map(m => m.name),
        totals: report.totals,
        tables: Object.fromEntries(Object.entries(report.tables).map(([name, t]) => [
          name,
          { inserted: t.inserted, skippedDuplicate: t.skippedDuplicate, failed: t.failed.total, transformed: t.transformed },
        ])),
        ...(report.replace ? { replace: report.replace } : {}),
        ...(report.wipe ? { wipeExisting: true, wipe: { total: report.wipe.total } } : {}),
        blobs: { written: blobs.written, skippedExisting: blobs.skippedExisting, failed: blobs.failed },
        reconcile: { checked: reconcile.checked, quarantined: reconcile.quarantined },
      },
      ip: opts.actor.ip,
      userAgent: opts.actor.userAgent,
      result: "success",
    }, { critical: true });

    job.result = report;
    job.state = "completed";
  }
  catch (err) {
    job.state = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    logger.error({ err, importId: job.id }, "backup import apply failed");
  }
}
