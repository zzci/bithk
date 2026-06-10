import type { ArchiveProgress, BackupManifestV2, BlobsMode } from "./archive.service";
/**
 * Backup v2 EXPORT JOB lifecycle (PLAN-075 R1, R7).
 *
 * Job bookkeeping is **in-memory** (process-local map), mirroring the v1
 * in-flight semaphore approach; the filesystem is the durable part. After a
 * crash/restart, in-memory jobs are gone (poll returns 404) and leftover
 * staging directories are reclaimed by the mtime-based TTL sweep.
 *
 * State machine:
 *
 *     pending ─► running ─► completed ─► downloaded ─► (cleaned, job gone)
 *                   │            │
 *                   │ error      │ DELETE / TTL expiry
 *                   ▼            ▼
 *                failed ──────► (cleaned)
 *
 * R7: a `separate`-mode job carries TWO artifacts (`data` + `blobs`) with
 * per-artifact downloaded flags; `completed → downloaded` (and staging
 * cleanup) fires only once EVERY artifact has been downloaded.
 *
 * Staging layout: `${DATA_DIR}/backup-staging/exports/<jobId>/`. The sweep
 * walks `backup-staging/**` generically so it also reclaims the future
 * `imports/` subtree.
 */
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT_DIR } from "@/root";
import { AppError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { ExportCancelledError, writeArchiveV2 } from "./archive.service";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MS_PER_HOUR = 60 * 60 * 1000;

export type ExportJobState = "pending" | "running" | "completed" | "downloaded" | "failed";

export type ExportArtifactKind = "data" | "blobs";

export interface ExportArtifact {
  readonly path: string;
  readonly size: number;
  downloaded: boolean;
}

export interface ExportJob {
  readonly id: string;
  state: ExportJobState;
  /** Modules as requested; the manifest records the resolved closure. */
  readonly modules: readonly string[];
  readonly blobsMode: BlobsMode;
  /**
   * Visibility owner (PLAN-075 R6): `undefined` for admin-created jobs,
   * the per-token bucket key for token-created ones. Token routes only see
   * jobs of their own bucket; admin routes see every job.
   */
  readonly ownerBucket?: string;
  /** Token-created jobs write redacted archives (`manifest.redacted`). */
  readonly redacted: boolean;
  readonly createdAt: string;
  readonly stagingDir: string;
  progress: ArchiveProgress;
  error?: string;
  /** Set on completion; `blobs` exists only for `separate`-mode jobs. */
  artifacts?: { data: ExportArtifact; blobs?: ExportArtifact };
  manifest?: BackupManifestV2;
  /** Abort flag — the archive writer checks it between batches/entries. */
  cancelRequested: boolean;
  /** Settles when the background runner exits (success, failure or cancel). */
  done: Promise<void>;
}

const jobs = new Map<string, ExportJob>();

/** Resolve the staging root under the persistent data volume. */
export function getBackupStagingRoot(config: Config): string {
  return config.DATA_DIR
    ? resolve(config.DATA_DIR, "backup-staging")
    : resolve(ROOT_DIR, "data", "backup-staging");
}

/** The process-wide one-running-export-job guard (WAL-pressure rationale). */
export function findRunningExportJob(): ExportJob | undefined {
  for (const job of jobs.values()) {
    if (job.state === "pending" || job.state === "running")
      return job;
  }
  return undefined;
}

export function getExportJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

export interface StartExportJobOptions {
  readonly modules: readonly string[];
  readonly blobsMode: BlobsMode;
  /** Token bucket of the creating service token; omit for admin jobs. */
  readonly ownerBucket?: string;
  /** Write the archive redacted (token-route policy). */
  readonly redacted?: boolean;
}

/**
 * Register a job and kick its background runner. Throws 409 when another
 * job is pending/running — at most one export generates at a time.
 */
export function startExportJob(
  db: AppDatabase,
  config: Config,
  opts: StartExportJobOptions,
  logger?: Logger,
): ExportJob {
  if (findRunningExportJob())
    throw new AppError("Another backup export job is already in progress.", 409, "EXPORT_IN_PROGRESS");

  const id = ulid();
  const stagingDir = resolve(getBackupStagingRoot(config), "exports", id);
  const job: ExportJob = {
    id,
    state: "pending",
    modules: [...opts.modules],
    blobsMode: opts.blobsMode,
    ...(opts.ownerBucket !== undefined ? { ownerBucket: opts.ownerBucket } : {}),
    redacted: opts.redacted === true,
    createdAt: new Date().toISOString(),
    stagingDir,
    progress: { tablesDone: 0, tablesTotal: 0, blobBytesDone: 0, blobBytesTotal: 0 },
    cancelRequested: false,
    done: Promise.resolve(),
  };
  jobs.set(id, job);

  job.done = (async () => {
    job.state = "running";
    try {
      const result = await writeArchiveV2({
        db,
        modules: opts.modules,
        blobsMode: opts.blobsMode,
        redacted: job.redacted,
        stagingDir,
        appName: config.APP_NAME,
        isCancelled: () => job.cancelRequested,
        onProgress: (p) => {
          job.progress = p;
        },
      });
      job.artifacts = {
        data: { path: result.archivePath, size: result.archiveSize, downloaded: false },
        ...(result.blobsArchivePath !== undefined
          ? { blobs: { path: result.blobsArchivePath, size: result.blobsArchiveSize ?? 0, downloaded: false } }
          : {}),
      };
      job.manifest = result.manifest;
      job.state = "completed";
    }
    catch (err) {
      job.state = "failed";
      job.error = err instanceof ExportCancelledError
        ? "cancelled"
        : err instanceof Error ? err.message : String(err);
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      catch {
        // Best-effort — leftover debris is reclaimed by the TTL sweep.
      }
      if (!(err instanceof ExportCancelledError))
        logger?.error({ err, jobId: id }, "backup export job failed");
    }
  })();

  return job;
}

/**
 * Cancel a running job (abort flag, then await the runner) or discard a
 * finished one. Removes the staging directory and forgets the job.
 * Returns false for an unknown job id.
 */
export async function cancelOrDiscardExportJob(id: string): Promise<boolean> {
  const job = jobs.get(id);
  if (!job)
    return false;
  if (job.state === "pending" || job.state === "running") {
    job.cancelRequested = true;
    await job.done;
  }
  rmSync(job.stagingDir, { recursive: true, force: true });
  jobs.delete(id);
  return true;
}

/**
 * The requested artifact of a `completed` job, or undefined in any other
 * state — a running job's `.partial` file is therefore never downloadable,
 * and a non-separate job has no `blobs` artifact at all.
 */
export function getDownloadableArchive(id: string, artifact: ExportArtifactKind = "data"): { path: string; size: number } | undefined {
  const job = jobs.get(id);
  if (!job || job.state !== "completed" || !job.artifacts)
    return undefined;
  const entry = job.artifacts[artifact];
  if (!entry)
    return undefined;
  return { path: entry.path, size: entry.size };
}

/**
 * Mark one artifact downloaded after its response body fully drained. Only
 * once EVERY artifact of the job has been downloaded does the job flip to
 * `downloaded`: staging removed, job forgotten. A separate-mode job
 * therefore survives its first download so the other artifact stays
 * fetchable (re-downloads of a fetched artifact are also fine until then).
 */
export function finalizeDownloadedExport(id: string, artifact: ExportArtifactKind = "data"): void {
  const job = jobs.get(id);
  if (!job || job.state !== "completed" || !job.artifacts)
    return;
  const entry = job.artifacts[artifact];
  if (!entry)
    return;
  entry.downloaded = true;
  if (!job.artifacts.data.downloaded || (job.artifacts.blobs && !job.artifacts.blobs.downloaded))
    return;
  job.state = "downloaded";
  rmSync(job.stagingDir, { recursive: true, force: true });
  jobs.delete(id);
}

/**
 * mtime-based TTL sweep over `backup-staging/**` — needs no job state.
 * Walks each subtree (`exports/`, the future `imports/`) one level down so
 * a fresh subtree directory does not shield old job directories, and also
 * reclaims stray files directly under the root. Returns entries removed.
 */
export function sweepBackupStaging(root: string, ttlHours: number): number {
  if (!existsSync(root))
    return 0;
  const cutoff = Date.now() - ttlHours * MS_PER_HOUR;
  let removed = 0;
  const removeIfExpired = (path: string): void => {
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path, { recursive: true, force: true });
      removed++;
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      for (const child of readdirSync(entryPath))
        removeIfExpired(resolve(entryPath, child));
    }
    else {
      removeIfExpired(entryPath);
    }
  }
  return removed;
}

let sweepTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Run the TTL sweep now (boot) and then hourly. Idempotent — a second call
 * no-ops while the timer is live.
 */
export function startBackupStagingSweep(config: Config, logger: Logger): void {
  if (sweepTimer)
    return;
  const root = getBackupStagingRoot(config);
  const run = (): void => {
    try {
      const removed = sweepBackupStaging(root, config.BACKUP_STAGING_TTL_HOURS);
      if (removed > 0)
        logger.info({ removed, root }, "backup staging TTL sweep");
    }
    catch (err) {
      logger.error({ err, root }, "backup staging TTL sweep failed");
    }
  };
  run();
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function stopBackupStagingSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}

/** Test-only: clear the job map and stop the sweep timer. */
export function __resetExportJobsForTests(): void {
  jobs.clear();
  stopBackupStagingSweep();
}

/** Test-only: register a synthetic job (e.g. to pin the one-running guard). */
export function __setExportJobForTests(job: ExportJob): void {
  jobs.set(job.id, job);
}
