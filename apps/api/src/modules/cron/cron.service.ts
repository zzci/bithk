import type { CronExpression } from "cronbake";
import type { ExecutorDeps, TaskConfig } from "./executor";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import Baker from "cronbake";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { cronJobLogs, cronJobs } from "@/modules/cron/schema";
import { AppError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { __resetAndReinitActionsForTests, getAction, getActionExecutor, getDefaultActions, validateActionConfig } from "./actions";
import { isValidCron, normalizeCron, SUPPORTED_CRON_FORMATS } from "./cron-format";
import { awaitInFlightJobs, executeTask, getInFlightJobCount } from "./executor";

export interface SchedulerDeps {
  readonly db: AppDatabase;
  readonly logger: Logger;
  readonly config: Config;
}

export interface CronScheduler {
  readonly baker: Baker;
  /** Sync a single job from DB state into Baker (add / update / remove). */
  readonly syncJob: (name: string) => Promise<void>;
}

// Baker is a genuine process-singleton (one timer per process). Routes
// pull the active handle via `getScheduler()` (null while not running).
// DB / logger / config are NOT cached on the handle — `syncJob` closes
// over the executorDeps built at `startCron` time, and routes thread
// their own `c.get("db" | "logger" | "config")` for any other work.
let _scheduler: CronScheduler | null = null;
let _shutdownLogger: Logger | null = null;

async function ensureDefaultJobs(db: AppDatabase, logger: Logger): Promise<void> {
  for (const { name, cron } of getDefaultActions()) {
    const existing = await db
      .select({ id: cronJobs.id })
      .from(cronJobs)
      .where(and(eq(cronJobs.name, name), eq(cronJobs.isDeleted, false)))
      .get();

    if (!existing) {
      // `taskType` mirrors the registered action's `category` — same
      // discriminator the create route uses, so default + user-created
      // rows are filterable through the same toolbar dropdown.
      const def = getAction(name);
      await db.insert(cronJobs).values({
        id: nanoid(),
        name,
        cron,
        taskType: def?.spec.category ?? "custom",
        taskConfig: JSON.stringify({ action: name }),
        enabled: true,
      }).run();
      logger.info({ name }, "cron_default_job_created");
    }
  }
}

/**
 * A `cron_job_logs` row stuck at `status='running'` with `finished_at IS NULL`
 * means the process died mid-execution (the `finally`/catch that finalizes the
 * row never ran). Left in place these ghost rows (a) pollute the admin UI's
 * lastStatus='running' filter forever and (b) corrupt `maybeAutoPause`'s
 * consecutive-failure streak. Reap them to `failed` once at boot, before any
 * job is scheduled, so a fresh run starts from a clean history.
 */
async function reapStaleRunningLogs(db: AppDatabase, logger: Logger): Promise<void> {
  try {
    const finishedAt = new Date().toISOString();
    const reaped = await db
      .update(cronJobLogs)
      .set({
        status: "failed",
        error: "Process exited while job was running (crash-detected on startup)",
        finishedAt,
      })
      .where(and(eq(cronJobLogs.status, "running"), isNull(cronJobLogs.finishedAt)))
      .returning({ id: cronJobLogs.id })
      .all();

    if (reaped.length > 0) {
      logger.warn({ count: reaped.length }, "cron_stale_running_logs_reaped");
    }
  }
  catch (err) {
    logger.error({ err }, "cron_stale_running_logs_reap_failed");
  }
}

function buildExecutorDeps(deps: SchedulerDeps, baker: Baker): ExecutorDeps {
  return {
    db: deps.db,
    logger: deps.logger,
    config: deps.config,
    onAutoPause: (jobName) => {
      try {
        baker.pause(jobName);
      }
      catch {
        // Job may have been removed already.
      }
    },
  };
}

function registerJob(
  baker: Baker,
  executorDeps: ExecutorDeps,
  row: typeof cronJobs.$inferSelect,
): void {
  const config = JSON.parse(row.taskConfig) as TaskConfig;

  baker.add({
    name: row.name,
    cron: normalizeCron(row.cron) as CronExpression,
    overrunProtection: true,
    callback: async () => {
      await executeTask(executorDeps, row.id, row.name, config, row.maxConsecutiveFailures);
    },
    onError: (error: Error) => {
      executorDeps.logger.error({ jobName: row.name, err: error }, "cron_job_callback_error");
    },
  });
}

async function loadJobsFromDb(
  baker: Baker,
  executorDeps: ExecutorDeps,
  db: AppDatabase,
): Promise<number> {
  const rows = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.enabled, true), eq(cronJobs.isDeleted, false)))
    .all();

  for (const row of rows) {
    try {
      registerJob(baker, executorDeps, row);
    }
    catch (err) {
      executorDeps.logger.error({ jobName: row.name, err }, "cron_job_register_failed");
    }
  }

  return rows.length;
}

async function syncJobInternal(
  baker: Baker,
  executorDeps: ExecutorDeps,
  db: AppDatabase,
  name: string,
): Promise<void> {
  try {
    baker.remove(name);
  }
  catch {
    // Not registered — fine.
  }

  const row = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.name, name), eq(cronJobs.isDeleted, false)))
    .get();

  if (row && row.enabled) {
    registerJob(baker, executorDeps, row);
    baker.bake(name);
    executorDeps.logger.info({ name }, "cron_job_synced");
  }
}

/**
 * Allocate the Baker timer, seed default jobs, load every
 * `enabled && !is_deleted` row into Baker, and start ticking.
 * Idempotent — re-invoking on an already-running scheduler is a no-op.
 *
 * Precondition: the action catalog has been populated (production
 * does this via `initCronActions()`; tests do it via the test reset
 * helper). Callers that skip both will hit "Unknown action" errors at
 * registration time.
 */
export async function startCron(deps: SchedulerDeps): Promise<void> {
  if (_scheduler)
    return;

  const baker = Baker.create({
    enableMetrics: true,
    // cronbake's default pollingInterval is 1s. Most schedules in this app
    // have minute (or coarser) resolution; a 30s poll keeps cron timing
    // responsive enough while cutting the wakeups-per-second load that
    // accumulates under tests with many short-lived jobs.
    schedulerConfig: { pollingInterval: 30_000 },
    onError: (error: Error, jobName: string) => {
      deps.logger.error({ jobName, err: error }, "cron_global_error");
    },
  });

  const executorDeps = buildExecutorDeps(deps, baker);

  // Reap crash-orphaned 'running' rows before anything is scheduled so the
  // first execution + the admin UI both see a consistent run history.
  await reapStaleRunningLogs(deps.db, deps.logger);

  try {
    await ensureDefaultJobs(deps.db, deps.logger);
  }
  catch (err) {
    deps.logger.error({ err }, "cron_ensure_defaults_failed");
  }

  const count = await loadJobsFromDb(baker, executorDeps, deps.db);

  try {
    baker.bakeAll();
  }
  catch (err) {
    deps.logger.error({ err }, "cron_bake_all_failed");
  }

  for (const { name, runOnStartup } of getDefaultActions()) {
    if (!runOnStartup)
      continue;
    const execute = getActionExecutor(name);
    if (!execute)
      continue;
    void execute({ db: deps.db, logger: deps.logger, config: deps.config }, { action: name }).catch((err: unknown) => {
      deps.logger.error({ err, action: name }, "cron_startup_run_error");
    });
  }

  deps.logger.info({ jobCount: count }, "cron_scheduler_started");

  _scheduler = {
    baker,
    syncJob: name => syncJobInternal(baker, executorDeps, deps.db, name),
  };
  _shutdownLogger = deps.logger;
}

// Bound the in-flight wait so shutdown still completes within the
// orchestrator's grace period. 20s leaves the outer shutdown some
// slack to flush + close the DB before SIGKILL lands.
const STOP_CRON_DRAIN_MS = 20_000;

/** Stop the scheduler and clear the singleton. No-op when not running. */
export async function stopCron(): Promise<void> {
  const handle = _scheduler;
  const logger = _shutdownLogger;
  if (!handle || !logger)
    return;
  try {
    // Detach Baker first so no new ticks fire while we drain in-flight work.
    handle.baker.stopAll();
    handle.baker.destroyAll();
    const stillRunning = getInFlightJobCount();
    if (stillRunning > 0) {
      logger.info({ inFlight: stillRunning }, "cron_scheduler_draining");
      const completed = await awaitInFlightJobs(STOP_CRON_DRAIN_MS);
      const remaining = getInFlightJobCount();
      if (remaining > 0) {
        logger.warn(
          { drained: completed, remaining },
          "cron_scheduler_drain_timeout",
        );
      }
    }
    logger.info("cron_scheduler_stopped");
  }
  catch (err) {
    logger.error({ err }, "cron_scheduler_stop_failed");
  }
  _scheduler = null;
  _shutdownLogger = null;
}

/**
 * Live scheduler handle, or `null` when `startCron` has not run.
 * Route handlers that touch Baker null-check the result so the
 * data-layer paths keep working with the scheduler off.
 */
export function getScheduler(): CronScheduler | null {
  return _scheduler;
}

// ─── Job CRUD (data layer behind cron.routes.ts) ─────────────────────
//
// Routes stay thin: parse/validate the wire shape, call one of these,
// audit, serialize. All drizzle access and Baker synchronisation for the
// job lifecycle lives here (REFACTOR-034).

export type CronJobRow = typeof cronJobs.$inferSelect;
export type CronJobLogRow = typeof cronJobLogs.$inferSelect;

/** Live (non-deleted) job by id, falling back to the unique name. */
export async function findJobByIdOrName(db: AppDatabase, identifier: string): Promise<CronJobRow | null> {
  const byId = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.isDeleted, false), eq(cronJobs.id, identifier)))
    .get();
  if (byId)
    return byId;

  const byName = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.isDeleted, false), eq(cronJobs.name, identifier)))
    .get();
  return byName ?? null;
}

/** Job by id regardless of tombstone state (run-history stays viewable). */
export async function getJobAnyById(db: AppDatabase, id: string): Promise<CronJobRow | undefined> {
  return await db.select().from(cronJobs).where(eq(cronJobs.id, id)).get();
}

export async function getJobLogById(db: AppDatabase, logId: string): Promise<CronJobLogRow | undefined> {
  return await db.select().from(cronJobLogs).where(eq(cronJobLogs.id, logId)).get();
}

export interface ListJobsParams {
  /** `null` = no tombstone constraint; boolean = `is_deleted` must equal. */
  readonly deletedFlag: boolean | null;
  readonly lastStatus?: "success" | "failed" | "running" | undefined;
  readonly taskType?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export async function listJobs(
  db: AppDatabase,
  params: ListJobsParams,
): Promise<{ rows: CronJobRow[]; hasMore: boolean; nextCursor: string | null }> {
  const conditions = [];
  if (params.deletedFlag !== null)
    conditions.push(eq(cronJobs.isDeleted, params.deletedFlag));
  if (params.taskType !== undefined)
    conditions.push(eq(cronJobs.taskType, params.taskType));
  if (params.cursor)
    conditions.push(lt(cronJobs.id, params.cursor));
  if (params.lastStatus !== undefined) {
    // Correlated subquery: keep the job iff its newest log row (by
    // ULID order, which is creation-time monotonic) matches the
    // requested status. Jobs with no logs at all are excluded from
    // every `lastStatus` filter because the inner SELECT is NULL.
    conditions.push(sql`(
      SELECT ${cronJobLogs.status} FROM ${cronJobLogs}
      WHERE ${cronJobLogs.jobId} = ${cronJobs.id}
      ORDER BY ${cronJobLogs.id} DESC
      LIMIT 1
    ) = ${params.lastStatus}`);
  }

  const rows = await db
    .select()
    .from(cronJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(cronJobs.createdAt))
    .limit(params.limit + 1)
    .all();

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? page.at(-1)!.id : null;
  return { rows: page, hasMore, nextCursor };
}

export interface ListJobLogsParams {
  readonly status?: "running" | "success" | "failed" | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export async function listJobLogs(
  db: AppDatabase,
  jobId: string,
  params: ListJobLogsParams,
): Promise<{ logs: CronJobLogRow[]; hasMore: boolean; nextCursor: string | null }> {
  const conditions = [eq(cronJobLogs.jobId, jobId)];
  if (params.status)
    conditions.push(eq(cronJobLogs.status, params.status));
  if (params.cursor)
    conditions.push(lt(cronJobLogs.id, params.cursor));

  const logs = await db
    .select()
    .from(cronJobLogs)
    .where(and(...conditions))
    .orderBy(desc(cronJobLogs.id))
    .limit(params.limit + 1)
    .all();

  const hasMore = logs.length > params.limit;
  const page = hasMore ? logs.slice(0, params.limit) : logs;
  const nextCursor = hasMore ? page.at(-1)!.id : null;
  return { logs: page, hasMore, nextCursor };
}

export interface CreateJobInput {
  readonly name: string;
  readonly cron: string;
  readonly action: string;
  readonly config?: Record<string, unknown> | undefined;
  readonly maxConsecutiveFailures?: number | undefined;
}

/**
 * Full create workflow: cron validation + normalisation, name-conflict
 * check, per-action config validation, insert, and (when the scheduler
 * is running) Baker sync. Returns the persisted row (`cron` normalized).
 */
export async function createJob(db: AppDatabase, input: CreateJobInput): Promise<CronJobRow> {
  if (!isValidCron(input.cron)) {
    throw new AppError(
      `Invalid cron expression: "${input.cron}". Supported formats: ${SUPPORTED_CRON_FORMATS.join("; ")}`,
      400,
      "INVALID_CRON",
    );
  }
  const normalized = normalizeCron(input.cron);

  const existing = await findJobByIdOrName(db, input.name);
  if (existing) {
    throw new AppError(`Job with name "${input.name}" already exists`, 409, "JOB_NAME_CONFLICT");
  }

  const taskConfig: TaskConfig = { ...(input.config ?? {}), action: input.action };
  const validationError = await validateActionConfig(input.action, taskConfig);
  if (validationError) {
    throw new AppError(validationError, 400, "INVALID_ACTION_CONFIG");
  }

  const actionDef = getAction(input.action);
  const id = nanoid();
  const insertValues: typeof cronJobs.$inferInsert = {
    id,
    name: input.name,
    cron: normalized,
    taskType: actionDef?.spec.category ?? "custom",
    taskConfig: JSON.stringify(taskConfig),
    enabled: true,
    ...(input.maxConsecutiveFailures !== undefined ? { maxConsecutiveFailures: input.maxConsecutiveFailures } : {}),
  };
  await db.insert(cronJobs).values(insertValues).run();

  const row = await db.select().from(cronJobs).where(eq(cronJobs.id, id)).get();
  if (!row)
    throw new AppError("Failed to create job", 500, "INTERNAL_ERROR");

  // When the scheduler isn't running the row still lands in the DB
  // and is picked up the next time `startCron` runs.
  await getScheduler()?.syncJob(input.name);

  return row;
}

/** Soft-delete: tombstone + disable in DB, then detach from Baker. */
export async function softDeleteJob(db: AppDatabase, job: CronJobRow): Promise<void> {
  await db.update(cronJobs)
    .set({ isDeleted: true, enabled: false })
    .where(eq(cronJobs.id, job.id))
    .run();

  const scheduler = getScheduler();
  if (scheduler) {
    try {
      scheduler.baker.stop(job.name);
      scheduler.baker.remove(job.name);
    }
    catch {
      // Not loaded in scheduler.
    }
  }
}

/** Disable in DB + stop the Baker timer (no-op when scheduler is off). */
export async function pauseJob(db: AppDatabase, job: CronJobRow): Promise<void> {
  await db.update(cronJobs).set({ enabled: false }).where(eq(cronJobs.id, job.id)).run();
  const scheduler = getScheduler();
  if (scheduler) {
    try {
      scheduler.baker.pause(job.name);
    }
    catch {}
  }
}

/** Re-enable in DB + re-sync into Baker (no-op when scheduler is off). */
export async function resumeJob(db: AppDatabase, job: CronJobRow): Promise<void> {
  await db.update(cronJobs).set({ enabled: true }).where(eq(cronJobs.id, job.id)).run();
  await getScheduler()?.syncJob(job.name);
}

/** Test-only: tear down the singleton + action registry so each test re-boots. */
export async function __resetCronForTests(): Promise<void> {
  await stopCron();
  __resetAndReinitActionsForTests();
}
