/**
 * Backup v2 APPLY orchestration (PLAN-075 R3/R4/R6 Phase 3; FIX-061 wipe;
 * FIX-062 replace removal + session-safe wipe).
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
 * - wipe-before-merge preflight (FIX-061): archive must contain an active
 *   admin; a web actor must match one by id OR email/oauthSub. Runs before
 *   the state flips — and therefore before any deletion.
 *
 * The only apply mode is `merge` — the Phase-2 mapping engine's row loop in
 * a COMMITTED synchronous transaction (`runImportMerge`); per-row semantics
 * and report keys identical to the dry-run. FIX-062 removed the v1-engine
 * `replace` mode: wipe-before-merge supersedes it without the exact-journal
 * schema gate. The v1 JSON restore route (`restore.routes.ts`) is untouched.
 *
 * The apply runner is fully detached from the request: it captures the
 * actor (and, for a wipe, the operator's session token) up front and never
 * reads the requester's session mid-job — a wipe import always completes
 * even if the operator's session is invalidated. For a web wipe the session
 * is re-created inside the merge transaction bound to the restored admin
 * (same token, so the cookie survives; see `import-mapping.ts`).
 *
 * After the row stage, the blob stage streams the staged archive again and
 * imports referenced blobs (legacy blob-bearing archives), a quarantine
 * rescan heals rows whose bytes are already on the storage backend
 * ("copy storage tree first, then import" needs zero extra steps), and
 * `reconcileRestoredFiles` quarantines rows still missing bytes. The final
 * report and the `backup.import.apply` audit (critical: a failed audit
 * write fails the apply) land on the job for the poll route.
 */
import type { ArchiveBlobStageReport, BlobRescanReport } from "./blob-restore";
import type { ImportTableReport } from "./import-mapping";
import type { ImportJob } from "./import.service";
import type { ReconcileResult } from "./restore.service";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { deleteUserSessions } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { audit } from "@/modules/audit/audit.service";
import { AppError } from "@/shared/lib/errors";
import { importArchiveBlobs, rescanQuarantinedFiles } from "./blob-restore";
import { runImportMerge } from "./import-mapping";
import { reconcileRestoredFiles } from "./restore.service";

/** Actor context captured at the route — audits are written async. */
export interface ImportApplyActor {
  readonly id: string;
  readonly name: string;
  readonly ip: string;
  readonly userAgent: string;
  /**
   * The web operator's session token (`sessions.id`, FIX-062) — captured at
   * the route so a wipe apply can re-bind the SAME token to the restored
   * admin inside the merge transaction. Absent for CLI/synthetic actors.
   */
  readonly sessionId?: string;
}

export interface ImportApplyOptions {
  /**
   * FIX-061: delete ALL registry rows (children first) in the same
   * transaction before the merge loop, so the import cannot conflict.
   * Guarded by {@link prepareWipe} BEFORE any deletion.
   */
  readonly wipeExisting?: boolean;
  readonly actor: ImportApplyActor;
}

export interface ImportApplyReport {
  readonly dryRun: false;
  /** Merge is the only apply mode (FIX-062 removed replace). */
  readonly mode: "merge";
  /** Identical keys/counts to the dry-run report. */
  readonly tables: Record<string, ImportTableReport>;
  readonly skippedTables: string[];
  readonly skippedModules: string[];
  readonly warnings: string[];
  readonly totals: { inserted: number; skippedDuplicate: number; failed: number; transformed: number };
  /** wipeExisting only (FIX-061) — per-table deleted-row counts. */
  readonly wipe?: { tables: Record<string, number>; total: number };
  readonly blobs: ArchiveBlobStageReport;
  /** FIX-062: the end-of-apply quarantine rescan (path-correspondence heal). */
  readonly rescan: BlobRescanReport;
  readonly reconcile: ReconcileResult;
}

// ─── Process-wide one-applying-at-a-time guard ───────────────────────────

let applyingJobId: string | undefined;

/** Test-only: clear the applying guard. */
export function __resetImportApplyForTests(): void {
  applyingJobId = undefined;
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
 * Validate the apply request (state machine + applying guard + wipe
 * preflight), flip the job to `applying`, and kick the background runner.
 * Returns once the runner is started; the result arrives via the poll
 * route (`completed` + `job.result` | `failed` + `job.error`) — readable
 * by ANY admin, not only the creator, so a lost session cannot hide the
 * outcome. Tests can `await job.done`.
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

  // Wipe preflight runs BEFORE the state flips, so a refused apply
  // (lock-out) leaves the job `validated` — and before any deletion.
  const wipePlan = opts.wipeExisting === true ? await prepareWipe(db, job, opts) : undefined;

  applyingJobId = job.id;
  job.state = "applying";
  job.done = runApply(db, job, opts, wipePlan, logger).finally(() => {
    applyingJobId = undefined;
  });
}

async function runApply(
  db: AppDatabase,
  job: ImportJob,
  opts: ImportApplyOptions,
  wipePlan: WipePlan | undefined,
  logger: Logger,
): Promise<void> {
  try {
    const warnings: string[] = [];

    // One committed synchronous transaction — an unexpected mid-apply
    // failure aborts it atomically (no partial table writes). With
    // wipeExisting the wipe runs INSIDE that transaction, so a failed
    // merge rolls the wipe back too (no data loss on failure). For a web
    // wipe the operator's session is captured pre-wipe and re-created
    // with the same token inside the same transaction (FIX-062).
    const engine = runImportMerge(db, job.manifest, job.tables, {
      wipeExisting: wipePlan !== undefined,
      ...(wipePlan !== undefined && opts.actor.sessionId !== undefined
        ? { preserveSessionId: opts.actor.sessionId }
        : {}),
    });
    warnings.push(...engine.warnings);

    if (wipePlan) {
      // v1-parity session revocation against the pre-wipe snapshot: a
      // pre-wipe user keeps their sessions only when the archive restored
      // them under the SAME id with the same role/status. Matching falls
      // back to email/oauthSub for cross-instance archives (a different id
      // means the old sessions are dangling anyway). Today the sessions FK
      // cascade already removes every session when `users` is wiped, so
      // this pass is a belt-and-suspenders parity guarantee — sparing only
      // the operator's re-bound session (FIX-062).
      const archiveUsers = (job.tables.get("users") ?? []) as readonly ArchiveUserRow[];
      for (const before of wipePlan.liveUsers) {
        const after = archiveUsers.find(r => r.id === before.id)
          ?? archiveUsers.find(r => r.oauthSub === before.oauthSub || r.email === before.email);
        if (!after || after.id !== before.id || after.role !== before.role || after.status !== before.status)
          await deleteUserSessions(db, before.id, opts.actor.sessionId);
      }
    }

    // Blob stage: import blobs from legacy blob-bearing archives, then the
    // FIX-062 rescan — rows whose bytes are ALREADY on the storage backend
    // (operator copied the tree/bucket before importing) heal with zero
    // extra steps — and the final reconcile pass quarantines the rest.
    const blobs = await importArchiveBlobs(db, job.archivePath, job.manifest, warnings, logger);
    const rescan = await rescanQuarantinedFiles(db, logger);
    if (rescan.healed > 0)
      warnings.push(`${rescan.healed} quarantined files row(s) un-quarantined after blob rescan`);
    const reconcile = await reconcileRestoredFiles(db, logger);

    const report: ImportApplyReport = {
      dryRun: false,
      mode: "merge",
      tables: engine.tables,
      skippedTables: engine.skippedTables,
      skippedModules: engine.skippedModules,
      warnings,
      totals: engine.totals,
      ...(engine.wipe ? { wipe: engine.wipe } : {}),
      blobs,
      rescan,
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
        mode: "merge",
        modules: job.manifest.modules.map(m => m.name),
        totals: report.totals,
        tables: Object.fromEntries(Object.entries(report.tables).map(([name, t]) => [
          name,
          { inserted: t.inserted, skippedDuplicate: t.skippedDuplicate, failed: t.failed.total, transformed: t.transformed },
        ])),
        ...(report.wipe ? { wipeExisting: true, wipe: { total: report.wipe.total } } : {}),
        blobs: { written: blobs.written, skippedExisting: blobs.skippedExisting, failed: blobs.failed },
        rescan: { scanned: rescan.scanned, healed: rescan.healed, stillMissing: rescan.stillMissing },
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
