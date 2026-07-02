import type { TaskConfig } from "./executor";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { getActionsCatalog } from "./actions";
import { SUPPORTED_CRON_FORMATS } from "./cron-format";
import {
  createJob,
  findJobByIdOrName,
  getJobAnyById,
  getJobLogById,
  getScheduler,
  listJobLogs,
  listJobs,
  pauseJob,
  resumeJob,
  softDeleteJob,
} from "./cron.service";
import { executeTask } from "./executor";
import { serializeJob } from "./serialize";

// Outer guardrails on the free-form action `config` payload (FIX-AUDIT-016).
// The per-action validator (`validateActionConfig`) checks field *shape*;
// these cap the raw payload so an admin can't persist a multi-megabyte or
// thousand-key blob into `cron_jobs.task_config`.
const MAX_CONFIG_KEYS = 50;
const MAX_CONFIG_KEY_LENGTH = 100;
const MAX_CONFIG_BYTES = 16 * 1024;

const createJobSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[\w-]+$/, "Name must be alphanumeric, underscore, or hyphen only"),
  cron: z.string().min(1).max(200),
  action: z.string().min(1).max(100),
  config: z
    .record(z.string().min(1).max(MAX_CONFIG_KEY_LENGTH), z.unknown())
    .refine(c => Object.keys(c).length <= MAX_CONFIG_KEYS, {
      message: `config may not exceed ${MAX_CONFIG_KEYS} keys`,
    })
    .refine(c => JSON.stringify(c).length <= MAX_CONFIG_BYTES, {
      message: `config exceeds the ${MAX_CONFIG_BYTES}-byte size limit`,
    })
    .optional(),
  // Retry budget: N consecutive failures flip `enabled=false`. `0`
  // disables auto-pause for jobs that must keep retrying. Cap matches
  // the executor's intent (the limit is the LIMIT clause on the recent
  // logs read; anything wildly large just wastes pages on every retry
  // check). 100 is a generous ceiling.
  maxConsecutiveFailures: z.coerce.number().int().min(0).max(100).optional(),
});

const listQuerySchema = z.object({
  // Lifecycle filter: `deleted=only` surfaces tombstones; `deleted=true`
  // includes them; otherwise (default) only live rows are returned.
  deleted: z.enum(["false", "true", "only"]).optional(),
  // Filter by the most-recent run's outcome. Matches the value stored
  // in `cron_job_logs.status`; "running" is excluded from the SPA's
  // dropdown but accepted here for symmetry / debugging.
  lastStatus: z.enum(["success", "failed", "running"]).optional(),
  // Filter by `cron_jobs.task_type` — the action's category captured
  // at create time. Free-form string because downstream apps can
  // register their own categories (`registerAction(..., { category })`).
  taskType: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

/**
 * Resolve the query string's `deleted` filter to the boolean the WHERE
 * clause needs. `null` = no constraint; `boolean` = the row must
 * equal. Exported so the SPA's filter wiring can be tested without
 * booting the HTTP stack.
 */
export function resolveDeletedFlag(value: "false" | "true" | "only" | undefined): boolean | null {
  if (value === "only")
    return true;
  if (value === "true")
    return null;
  return false;
}

const logsQuerySchema = z.object({
  status: z.enum(["running", "success", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const idParamSchema = z.object({ id: z.string() });

// ─── Response schemas (mirror the real handler payloads) ──────────────
const lastRunSchema = z.object({
  status: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  result: z.string().nullable(),
  error: z.string().nullable(),
});
const cronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  cron: z.string(),
  taskType: z.string(),
  taskConfig: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  status: z.string(),
  nextExecution: z.string().nullable(),
  lastRun: lastRunSchema.nullable(),
  maxConsecutiveFailures: z.number(),
  isDeleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const cronLogSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  status: z.enum(["running", "success", "failed"]),
  result: z.string().nullable(),
  error: z.string().nullable(),
});

// Auth + admin gates apply to every route on this router.
const authErrors = { 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson } };

export function cronRoutes() {
  const router = new Hono<ProtectedEnv>();

  // Admin-only: operators that can edit schedules can also execute
  // arbitrary actions, so the gate matches the blast radius of the
  // route. Handlers below treat `getScheduler()` as nullable — when
  // the scheduler is not running, DB writes still land and the Baker
  // side effects no-op.
  router.use("*", authRequired);
  router.use("*", adminRequired);

  // GET /cron/actions — registered action catalog + cron-format reference + scheduler state.
  router.get(
    "/cron/actions",
    describeRoute({
      tags: ["infra2"],
      summary: "List registered cron actions, formats, and scheduler state",
      responses: {
        200: okJson(z.object({
          actions: z.array(z.unknown()),
          cronFormats: z.array(z.string()),
          schedulerEnabled: z.boolean(),
        })),
        ...authErrors,
      },
    }),
    async (c) => {
      return c.json({
        success: true,
        data: {
          actions: getActionsCatalog(),
          cronFormats: SUPPORTED_CRON_FORMATS,
          // SPA renders a status hint when this is false. Driven by the
          // singleton handle so a future hot-toggle (start/stop without
          // process restart) flips the flag immediately.
          schedulerEnabled: getScheduler() !== null,
        },
      });
    },
  );

  // GET /cron/jobs — cursor-paginated listing
  router.get(
    "/cron/jobs",
    describeRoute({
      tags: ["infra2"],
      summary: "List cron jobs (cursor-paginated, filterable)",
      responses: {
        200: okJson(z.object({
          jobs: z.array(cronJobSchema),
          hasMore: z.boolean(),
          nextCursor: z.string().nullable(),
        })),
        ...authErrors,
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const q = c.req.valid("query");

      const { rows, hasMore, nextCursor } = await listJobs(db, {
        deletedFlag: resolveDeletedFlag(q.deleted),
        lastStatus: q.lastStatus,
        taskType: q.taskType,
        cursor: q.cursor,
        limit: q.limit ?? 20,
      });

      const scheduler = getScheduler();
      const data = await Promise.all(rows.map(r => serializeJob(db, scheduler?.baker ?? null, r)));

      return c.json({
        success: true,
        data: { jobs: data, hasMore, nextCursor },
      });
    },
  );

  // POST /cron/jobs — create
  router.post(
    "/cron/jobs",
    describeRoute({
      tags: ["infra2"],
      summary: "Create a cron job",
      responses: {
        201: okJson(cronJobSchema, "Created"),
        400: { description: "Invalid cron / action config / name conflict", ...errorJson },
        409: { description: "Job name conflict", ...errorJson },
        ...authErrors,
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("json", createJobSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");

      const row = await createJob(db, body);

      await auditFromCtx(c, {
        action: "cron.job.created",
        resourceType: "cron_job",
        resourceId: row.id,
        resourceName: body.name,
        detail: {
          // `row.cron` is the normalized form persisted by the service.
          cron: row.cron,
          action: body.action,
          maxConsecutiveFailures: row.maxConsecutiveFailures,
        },
        result: "success",
      });

      const data = await serializeJob(db, getScheduler()?.baker ?? null, row);
      return c.json({ success: true, data }, 201);
    },
  );

  // DELETE /cron/jobs/:id — soft delete (also detaches from Baker)
  router.delete(
    "/cron/jobs/:id",
    describeRoute({
      tags: ["infra2"],
      summary: "Delete (soft) a cron job",
      responses: {
        200: okJson(z.object({ deleted: z.literal(true), name: z.string() })),
        ...authErrors,
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: identifier } = c.req.valid("param");
      const row = await findJobByIdOrName(db, identifier);
      if (!row)
        throw new NotFoundError("Cron job", identifier);

      await softDeleteJob(db, row);

      await auditFromCtx(c, {
        action: "cron.job.deleted",
        resourceType: "cron_job",
        resourceId: row.id,
        resourceName: row.name,
        result: "success",
      });

      return c.json({ success: true, data: { deleted: true, name: row.name } });
    },
  );

  // GET /cron/jobs/:id/logs — cursor-paginated run history
  router.get(
    "/cron/jobs/:id/logs",
    describeRoute({
      tags: ["infra2"],
      summary: "List a cron job's run history (cursor-paginated)",
      responses: {
        200: okJson(z.object({
          jobName: z.string(),
          logs: z.array(cronLogSchema),
          hasMore: z.boolean(),
          nextCursor: z.string().nullable(),
        })),
        ...authErrors,
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("query", logsQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: identifier } = c.req.valid("param");
      const q = c.req.valid("query");

      const job = await getJobAnyById(db, identifier);
      if (!job)
        throw new NotFoundError("Cron job", identifier);

      const { logs, hasMore, nextCursor } = await listJobLogs(db, job.id, {
        status: q.status,
        cursor: q.cursor,
        limit: q.limit ?? 20,
      });

      return c.json({
        success: true,
        data: {
          jobName: job.name,
          logs,
          hasMore,
          nextCursor,
        },
      });
    },
  );

  // POST /cron/jobs/:id/trigger — manual run (rejects when already running)
  router.post(
    "/cron/jobs/:id/trigger",
    describeRoute({
      tags: ["infra2"],
      summary: "Manually trigger a cron job",
      responses: {
        200: okJson(z.object({
          triggered: z.literal(true),
          name: z.string(),
          log: z.object({
            id: z.string(),
            status: z.string(),
            durationMs: z.number().nullable(),
            result: z.string().nullable(),
            error: z.string().nullable(),
          }).nullable(),
        })),
        ...authErrors,
        404: { description: "Not found", ...errorJson },
        500: { description: "Corrupt task config", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: identifier } = c.req.valid("param");
      const row = await findJobByIdOrName(db, identifier);
      if (!row)
        throw new NotFoundError("Cron job", identifier);

      const scheduler = getScheduler();
      // No pre-flight "is it executing?" check: cronbake's `getStatus` returns
      // `"running"` for any baked-and-active job (the scheduler timer is on),
      // not "mid execution". Manual trigger bypasses Baker's overrunProtection
      // by design — operators accept that a hand-triggered run may overlap
      // with a scheduled tick. The handler itself is the right place to lock
      // if a task truly cannot run concurrently.

      let config: TaskConfig;
      try {
        config = JSON.parse(row.taskConfig) as TaskConfig;
      }
      catch {
        throw new AppError(`Job "${row.name}" has corrupt taskConfig`, 500, "CORRUPT_CONFIG");
      }

      // Without a scheduler the auto-pause path still sets
      // `enabled=false` in DB; the Baker `pause(...)` call is a no-op.
      const executorDeps = scheduler
        ? {
            db,
            logger: c.get("logger"),
            config: c.get("config"),
            onAutoPause: (jobName: string) => {
              try {
                scheduler.baker.pause(jobName);
              }
              catch {}
            },
          }
        : { db, logger: c.get("logger"), config: c.get("config") };
      const logId = await executeTask(
        executorDeps,
        row.id,
        row.name,
        config,
        row.maxConsecutiveFailures,
      );

      const log = await getJobLogById(db, logId);

      await auditFromCtx(c, {
        action: "cron.job.triggered",
        resourceType: "cron_job",
        resourceId: row.id,
        resourceName: row.name,
        detail: { logId, status: log?.status },
        result: "success",
      });

      return c.json({
        success: true,
        data: {
          triggered: true,
          name: row.name,
          log: log
            ? { id: log.id, status: log.status, durationMs: log.durationMs, result: log.result, error: log.error }
            : null,
        },
      });
    },
  );

  // POST /cron/jobs/:id/pause — disable + stop ticking
  router.post(
    "/cron/jobs/:id/pause",
    describeRoute({
      tags: ["infra2"],
      summary: "Pause a cron job",
      responses: {
        200: okJson(z.object({ paused: z.literal(true), name: z.string() })),
        ...authErrors,
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: identifier } = c.req.valid("param");
      const row = await findJobByIdOrName(db, identifier);
      if (!row)
        throw new NotFoundError("Cron job", identifier);

      await pauseJob(db, row);

      await auditFromCtx(c, {
        action: "cron.job.paused",
        resourceType: "cron_job",
        resourceId: row.id,
        resourceName: row.name,
        result: "success",
      });

      return c.json({ success: true, data: { paused: true, name: row.name } });
    },
  );

  // POST /cron/jobs/:id/resume — re-enable + re-sync into Baker
  router.post(
    "/cron/jobs/:id/resume",
    describeRoute({
      tags: ["infra2"],
      summary: "Resume a cron job",
      responses: {
        200: okJson(z.object({ resumed: z.literal(true), name: z.string() })),
        ...authErrors,
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: identifier } = c.req.valid("param");
      const row = await findJobByIdOrName(db, identifier);
      if (!row)
        throw new NotFoundError("Cron job", identifier);

      await resumeJob(db, row);

      await auditFromCtx(c, {
        action: "cron.job.resumed",
        resourceType: "cron_job",
        resourceId: row.id,
        resourceName: row.name,
        result: "success",
      });

      return c.json({ success: true, data: { resumed: true, name: row.name } });
    },
  );

  return router;
}
