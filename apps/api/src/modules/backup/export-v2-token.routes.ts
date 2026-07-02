/**
 * Backup v2 EXPORT token routes (PLAN-075 R6 — service-token parity).
 *
 *   POST /backup/v2/exports-via-token                 start a REDACTED export job
 *   GET  /backup/v2/exports/:jobId/status-via-token   poll an own-bucket job
 *   GET  /backup/v2/exports/:jobId/download-via-token?artifact=data|blobs
 *
 * Same blast-radius hardening as the v1 `/backup/export-via-token` route:
 * the bearer is a single static secret with no per-request identity, so
 *   1. the archive is REDACTED — secret-typed fields (`SECRET_FIELD_NAMES`)
 *      are scrubbed per NDJSON row and `manifest.redacted` is true;
 *   2. the request MUST name an explicit module scope; an unscoped request
 *      FAILS CLOSED (403) — there is no "export everything" default;
 *   3. the v1 per-token in-flight semaphore and
 *      `BACKUP_EXPORT_MIN_INTERVAL_SECONDS` gate apply to the trigger
 *      (shared state with v1 — one token, one export pipeline), on top of
 *      the process-wide one-running-export-job guard.
 * Job visibility is bucket-scoped: token routes only see jobs created by
 * the same token bucket (admin jobs 404 here); admin routes see every job.
 * Binding the allowed module scope to the token itself remains the v1
 * leftover (PLAN-075 open question 4) — out of this lane.
 *
 * Admin v2 exports stay UNREDACTED — see `export-v2.routes.ts`.
 */
import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { buildContentDisposition } from "@/shared/lib/content-disposition";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { serviceTokenRequired } from "@/shared/middleware/service-token";
import {
  finalizeDownloadedExport,
  findRunningExportJob,
  getDownloadableArchive,
  getExportJob,
  startExportJob,
} from "./export-job.service";
import {
  backupExportInFlight,
  backupExportLastSuccess,
  tokenBucketKey,
} from "./export.routes";
import { getModuleNames } from "./registry";

const RE_TIMESTAMP_CHARS = /[:.]/g;

const jobParamSchema = z.object({ jobId: z.string() });
const exportJobStatusSchema = z.object({
  jobId: z.string(),
  state: z.string(),
  modules: z.array(z.string()),
  blobsMode: z.string(),
  createdAt: z.union([z.string(), z.number()]),
  progress: z.unknown(),
  error: z.string().nullable(),
  archiveSize: z.number().nullable(),
  artifacts: z.unknown().nullable(),
  // Manifest warnings (e.g. blobs skipped per-driver) — null until completed.
  warnings: z.array(z.string()).nullable(),
});
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };
function rawJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}
const gzipDownload = { description: "Streaming gzip archive", content: { "application/gzip": {} } };

function bucketOf(c: Context<ProtectedEnv>): string {
  const authz = c.req.header("authorization") ?? "";
  return tokenBucketKey(authz.startsWith("Bearer ") ? authz.slice(7) : "");
}

function tokenAuditBase(c: Context<ProtectedEnv>) {
  return {
    actorId: "system",
    actorName: "system:backup-sidecar",
    resourceType: "system",
    resourceId: "database",
    resourceName: "database-backup-export",
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "service-token",
  } as const;
}

export function backupExportV2TokenRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.post(
    "/backup/v2/exports-via-token",
    describeRoute({
      tags: ["infra2"],
      summary: "Service-token redacted async export job",
      requestBody: { content: { "application/json": { schema: { type: "object", properties: { modules: { type: "array", items: { type: "string" } }, blobs: { type: "string", enum: ["embedded", "separate", "none"] }, includeBlobs: { type: "boolean" } }, required: ["modules"] } } } },
      responses: {
        202: rawJson(z.object({ jobId: z.string() }), "Accepted"),
        400: { description: "Unknown modules", ...errorJson },
        401: { description: "Missing/invalid service token", ...errorJson },
        403: { description: "Module scope required", ...errorJson },
        409: { description: "Another export job in progress", ...errorJson },
        422: { description: "Validation error", ...errorJson },
        429: { description: "Export throttled / already in progress", ...errorJson },
      },
    }),
    serviceTokenRequired("backup"),
    async (c) => {
      const db = c.get("db");
      const config = c.get("config");
      const bucket = bucketOf(c);

      // Scope enforcement — FAIL CLOSED, exactly like the v1 token route: a
      // missing/empty/invalid-JSON body is "no scope" and rejected so a token
      // can never trigger a blanket full-DB dump.
      let raw: unknown;
      try {
        raw = await c.req.json();
      }
      catch {
        raw = undefined;
      }
      const scoped = z.object({ modules: z.array(z.string()).min(1) }).safeParse(raw);
      if (!scoped.success) {
        await audit(db, c.get("logger"), {
          ...tokenAuditBase(c),
          action: "backup.export",
          detail: { reason: "unscoped" },
          result: "failure",
        });
        return c.json({ success: false, error: { code: "SCOPE_REQUIRED", message: "A non-empty module scope is required for token export." } }, 403);
      }
      // Full body — same shape as the admin trigger (`blobs` wins over the
      // deprecated `includeBlobs` alias); a malformed mode is a 422.
      const body = z.object({
        modules: z.array(z.string()).min(1),
        blobs: z.enum(["embedded", "separate", "none"]).optional(),
        includeBlobs: z.boolean().optional(),
      }).parse(raw);
      const blobsMode = body.blobs ?? (body.includeBlobs === false ? "none" : "embedded");

      const known = new Set(getModuleNames());
      const invalidModules = body.modules.filter(m => !known.has(m));
      if (invalidModules.length > 0)
        return c.json({ success: false, error: { code: "INVALID_MODULES", message: `Unknown modules: ${invalidModules.join(", ")}` } }, 400);

      // v1 per-token gates, SHARED with the v1 streaming route. The in-flight
      // marker is held until the job's background runner settles.
      if (backupExportInFlight.has(bucket)) {
        c.header("Retry-After", "60");
        await audit(db, c.get("logger"), {
          ...tokenAuditBase(c),
          action: "backup.export",
          detail: { reason: "in-flight" },
          result: "failure",
        });
        return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Another export is in progress for this token." } }, 429);
      }
      const minIntervalMs = config.BACKUP_EXPORT_MIN_INTERVAL_SECONDS * 1000;
      if (minIntervalMs > 0) {
        const last = backupExportLastSuccess.get(bucket);
        if (last !== undefined) {
          const elapsed = Date.now() - last;
          if (elapsed < minIntervalMs) {
            const retryAfter = Math.ceil((minIntervalMs - elapsed) / 1000);
            c.header("Retry-After", String(retryAfter));
            await audit(db, c.get("logger"), {
              ...tokenAuditBase(c),
              action: "backup.export",
              detail: { reason: "min-interval", retryAfter },
              result: "failure",
            });
            return c.json({ success: false, error: { code: "RATE_LIMITED", message: `Backup export throttled. Retry after ${retryAfter}s.` } }, 429);
          }
        }
      }

      // Process-wide one-running-export-job guard — the token trigger respects
      // it on top of its own semaphore (admin and token jobs share the WAL).
      if (findRunningExportJob())
        throw new AppError("Another backup export job is already in progress.", 409, "EXPORT_IN_PROGRESS");

      // Audit is critical for this data-exfiltrating action: a failed write
      // re-throws and the job is never started.
      await audit(db, c.get("logger"), {
        ...tokenAuditBase(c),
        action: "backup.export",
        detail: { modules: body.modules, blobs: blobsMode, via: "token", redacted: true },
        result: "success",
      }, { critical: true });

      const job = startExportJob(db, config, {
        modules: body.modules,
        blobsMode,
        ownerBucket: bucket,
        redacted: true,
      }, c.get("logger"));
      backupExportInFlight.add(bucket);
      backupExportLastSuccess.set(bucket, Date.now());
      void job.done.finally(() => backupExportInFlight.delete(bucket));
      return c.json({ jobId: job.id }, 202);
    },
  );

  router.get(
    "/backup/v2/exports/:jobId/status-via-token",
    describeRoute({
      tags: ["infra2"],
      summary: "Poll an own-bucket export job (service token)",
      responses: {
        200: rawJson(exportJobStatusSchema),
        401: { description: "Missing/invalid service token", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    serviceTokenRequired("backup"),
    validator("param", jobParamSchema, onValidationFailure),
    (c) => {
      const { jobId } = c.req.valid("param");
      const job = getExportJob(jobId);
      // Visibility isolation: a job from another bucket — or an admin job
      // (no bucket) — is indistinguishable from a missing one.
      if (!job || job.ownerBucket !== bucketOf(c))
        throw new NotFoundError("Export job", jobId);
      // Same response shape as the admin poll route.
      return c.json({
        jobId: job.id,
        state: job.state,
        modules: job.modules,
        blobsMode: job.blobsMode,
        createdAt: job.createdAt,
        progress: job.progress,
        error: job.error ?? null,
        archiveSize: job.artifacts?.data.size ?? null,
        warnings: job.manifest ? [...job.manifest.warnings] : null,
        artifacts: job.artifacts
          ? {
              data: { size: job.artifacts.data.size, downloaded: job.artifacts.data.downloaded },
              ...(job.artifacts.blobs
                ? { blobs: { size: job.artifacts.blobs.size, downloaded: job.artifacts.blobs.downloaded } }
                : {}),
            }
          : null,
      });
    },
  );

  router.get(
    "/backup/v2/exports/:jobId/download-via-token",
    describeRoute({
      tags: ["infra2"],
      summary: "Download an own-bucket export artifact (service token)",
      parameters: [{ name: "artifact", in: "query", required: false, schema: { type: "string", enum: ["data", "blobs"] } }],
      responses: {
        200: gzipDownload,
        400: { description: "Invalid / unavailable artifact", ...errorJson },
        401: { description: "Missing/invalid service token", ...errorJson },
        404: { description: "Archive not ready", ...errorJson },
      },
    }),
    serviceTokenRequired("backup"),
    validator("param", jobParamSchema, onValidationFailure),
    async (c) => {
      const { jobId } = c.req.valid("param");
      const job = getExportJob(jobId);
      if (!job || job.ownerBucket !== bucketOf(c))
        throw new NotFoundError("Export job", jobId);

      // `?artifact` parity with the admin download route (R7).
      const artifactParam = c.req.query("artifact") ?? "data";
      if (artifactParam !== "data" && artifactParam !== "blobs")
        throw new AppError(`Unknown artifact '${artifactParam}' — expected 'data' or 'blobs'.`, 400, "INVALID_ARTIFACT");
      if (artifactParam === "blobs" && job.blobsMode !== "separate")
        throw new AppError("This export job has no separate blobs artifact.", 400, "NO_BLOBS_ARTIFACT");
      // 404 until `completed` — a running job's `.partial` is never served.
      const archive = getDownloadableArchive(jobId, artifactParam);
      if (!archive)
        throw new NotFoundError("Export archive", jobId);

      await audit(c.get("db"), c.get("logger"), {
        ...tokenAuditBase(c),
        action: "backup.export.download",
        detail: { jobId, artifact: artifactParam, via: "token" },
        result: "success",
      }, { critical: true });

      // Same downloaded/cleanup lifecycle as the admin route: the artifact is
      // marked downloaded only after the body fully drains; staging is removed
      // once EVERY artifact has been downloaded.
      const reader = Bun.file(archive.path).stream().getReader();
      const responseBody = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            finalizeDownloadedExport(jobId, artifactParam);
          }
          else {
            controller.enqueue(value);
          }
        },
        cancel(reason) {
          void reader.cancel(reason);
        },
      });

      const timestamp = new Date().toISOString().replace(RE_TIMESTAMP_CHARS, "-").slice(0, 19);
      const suffix = artifactParam === "blobs" ? "-blobs" : "";
      return new Response(responseBody, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": buildContentDisposition("attachment", `${c.get("config").APP_NAME}-backup-v2${suffix}-${timestamp}.tar.gz`),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );

  return router;
}
