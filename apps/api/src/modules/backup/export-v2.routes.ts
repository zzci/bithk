/**
 * Backup v2 EXPORT routes (PLAN-075 R1/R6/R7) — admin-only async-job
 * flavour of the v1 streaming export:
 *
 *   POST   /backup/v2/exports               start a server-side export job
 *   GET    /backup/v2/exports/:jobId        poll state + progress
 *   GET    /backup/v2/exports/:jobId/download?artifact=data|blobs
 *                                           stream a finished artifact
 *   DELETE /backup/v2/exports/:jobId        cancel running / discard finished
 *
 * FIX-062: backups are DB data only — the trigger no longer takes a blob
 * placement option (a legacy `blobs` / `includeBlobs` body field is ignored)
 * and every job produces a single `data` artifact with
 * `manifest.blobsMode: "external"`. File bytes are the operator's
 * responsibility (copy the storage tree / bucket).
 *
 * Token-route parity (`*-via-token`) is Phase 6; the import path is
 * Phase 2/3. v1 routes are untouched.
 */
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { buildContentDisposition } from "@/shared/lib/content-disposition";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  cancelOrDiscardExportJob,
  finalizeDownloadedExport,
  findRunningExportJob,
  getDownloadableArchive,
  getExportJob,
  startExportJob,
} from "./export-job.service";
import { getModuleNames } from "./registry";

const RE_TIMESTAMP_CHARS = /[:.]/g;

const jobParamSchema = z.object({ jobId: z.string() });
// FIX-062: no blob placement option — a legacy `blobs` / `includeBlobs` body
// field from an older client is stripped by zod and ignored.
const exportV2BodySchema = z.object({
  modules: z.array(z.string()).min(1),
});
// Mirrors the poll handler's payload over `ExportJob` (export-job.service.ts).
const exportArtifactSchema = z.object({
  size: z.number(),
  downloaded: z.boolean(),
});
const exportJobStatusSchema = z.object({
  jobId: z.string(),
  state: z.enum(["pending", "running", "completed", "downloaded", "failed"]),
  modules: z.array(z.string()),
  blobsMode: z.literal("external"),
  createdAt: z.union([z.string(), z.number()]),
  progress: z.object({
    tablesDone: z.number(),
    tablesTotal: z.number(),
    blobBytesDone: z.number(),
    blobBytesTotal: z.number(),
  }),
  error: z.string().nullable(),
  archiveSize: z.number().nullable(),
  // Per-artifact view; `blobs` appears only for separate-mode jobs. Null
  // until the job completes.
  artifacts: z.object({
    data: exportArtifactSchema,
    blobs: exportArtifactSchema.optional(),
  }).nullable(),
  // Manifest warnings (e.g. blobs skipped per-driver) — null until completed.
  warnings: z.array(z.string()).nullable(),
});
function rawJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}
const gzipDownload = { description: "Streaming gzip archive", content: { "application/gzip": {} } };

export function backupExportV2Routes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.post(
    "/backup/v2/exports",
    describeRoute({
      tags: ["infra2"],
      summary: "Start an async backup export job",
      responses: {
        202: rawJson(z.object({ jobId: z.string() }), "Accepted"),
        400: { description: "Unknown modules", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        409: { description: "Another export job in progress", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("json", exportV2BodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");

      const body = c.req.valid("json");

      const known = new Set(getModuleNames());
      const invalidModules = body.modules.filter(m => !known.has(m));
      if (invalidModules.length > 0)
        throw new AppError(`Unknown modules: ${invalidModules.join(", ")}`, 400, "INVALID_MODULES");

      // Process-wide one-running-export-job guard — same WAL-pressure
      // rationale as the v1 per-token semaphore.
      if (findRunningExportJob())
        throw new AppError("Another backup export job is already in progress.", 409, "EXPORT_IN_PROGRESS");

      // Audit is critical for this data-exfiltrating action: a failed write
      // re-throws and the job is never started.
      await auditFromCtx(c, {
        action: "backup.export",
        resourceType: "system",
        resourceId: "database",
        resourceName: "database-backup-export",
        detail: { modules: body.modules, blobs: "external", via: "admin" },
        result: "success",
      }, { critical: true });

      const job = startExportJob(db, c.get("config"), { modules: body.modules }, c.get("logger"));
      return c.json({ jobId: job.id }, 202);
    },
  );

  router.get(
    "/backup/v2/exports/:jobId",
    describeRoute({
      tags: ["infra2"],
      summary: "Poll an export job's state and progress",
      responses: {
        200: rawJson(exportJobStatusSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", jobParamSchema, onValidationFailure),
    (c) => {
      const { jobId } = c.req.valid("param");
      const job = getExportJob(jobId);
      if (!job)
        throw new NotFoundError("Export job", jobId);
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
        // Per-artifact view; `blobs` appears only for separate-mode jobs.
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
    "/backup/v2/exports/:jobId/download",
    describeRoute({
      tags: ["infra2"],
      summary: "Download a finished export artifact (data or blobs)",
      parameters: [{ name: "artifact", in: "query", required: false, schema: { type: "string", enum: ["data", "blobs"] } }],
      responses: {
        200: gzipDownload,
        400: { description: "Invalid / unavailable artifact", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        404: { description: "Archive not ready", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", jobParamSchema, onValidationFailure),
    async (c) => {
      const { jobId } = c.req.valid("param");
      const artifactParam = c.req.query("artifact") ?? "data";
      if (artifactParam !== "data" && artifactParam !== "blobs")
        throw new AppError(`Unknown artifact '${artifactParam}' — expected 'data' or 'blobs'.`, 400, "INVALID_ARTIFACT");
      // A non-separate job never has a blobs artifact — that is a caller
      // error (400), not a not-ready-yet (404).
      const job = getExportJob(jobId);
      if (artifactParam === "blobs" && job && job.blobsMode !== "separate")
        throw new AppError("This export job has no separate blobs artifact.", 400, "NO_BLOBS_ARTIFACT");
      // 404 until `completed` — a running job's `.partial` is never served.
      const archive = getDownloadableArchive(jobId, artifactParam);
      if (!archive)
        throw new NotFoundError("Export archive", jobId);

      await auditFromCtx(c, {
        action: "backup.export.download",
        resourceType: "system",
        resourceId: "database",
        resourceName: "database-backup-export",
        detail: { jobId, artifact: artifactParam },
        result: "success",
      }, { critical: true });

      // Pull-based wrapper (backpressure for multi-GB archives) that marks
      // the artifact downloaded only after the body fully drains — staging
      // is removed once EVERY artifact has been downloaded. A client
      // disconnect keeps the artifact so the operator can retry; the TTL
      // sweep reclaims it otherwise.
      const reader = Bun.file(archive.path).stream().getReader();
      const body = new ReadableStream<Uint8Array>({
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
      return new Response(body, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": buildContentDisposition("attachment", `${c.get("config").APP_NAME}-backup-v2${suffix}-${timestamp}.tar.gz`),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );

  router.delete(
    "/backup/v2/exports/:jobId",
    describeRoute({
      tags: ["infra2"],
      summary: "Cancel a running export job or discard a finished one",
      responses: {
        200: rawJson(z.object({ success: z.literal(true) })),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", jobParamSchema, onValidationFailure),
    async (c) => {
      const { jobId } = c.req.valid("param");
      const removed = await cancelOrDiscardExportJob(jobId);
      if (!removed)
        throw new NotFoundError("Export job", jobId);
      return c.json({ success: true });
    },
  );

  return router;
}
