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
 * R7: the trigger body takes `blobs: "embedded" | "separate" | "none"`
 * (default embedded); `includeBlobs` remains as a deprecated alias
 * (true→embedded, false→none; explicit `blobs` wins). Separate-mode jobs
 * expose a second `blobs` artifact on the download route.
 *
 * Token-route parity (`*-via-token`) is Phase 6; the import path is
 * Phase 2/3. v1 routes are untouched.
 */
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { buildContentDisposition } from "@/shared/lib/content-disposition";
import { AppError, NotFoundError } from "@/shared/lib/errors";
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

export function backupExportV2Routes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.post("/backup/v2/exports", adminRequired, async (c) => {
    const db = c.get("db");
    const user = c.get("user");

    const body = z.object({
      modules: z.array(z.string()).min(1),
      blobs: z.enum(["embedded", "separate", "none"]).optional(),
      // Deprecated alias (true→embedded, false→none); `blobs` wins if both sent.
      includeBlobs: z.boolean().optional(),
    }).parse(await c.req.json());
    const blobsMode = body.blobs ?? (body.includeBlobs === false ? "none" : "embedded");

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
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "backup.export",
      resourceType: "system",
      resourceId: "database",
      resourceName: "database-backup-export",
      detail: { modules: body.modules, blobs: blobsMode, via: "admin" },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    }, { critical: true });

    const job = startExportJob(db, c.get("config"), { modules: body.modules, blobsMode }, c.get("logger"));
    return c.json({ jobId: job.id }, 202);
  });

  router.get("/backup/v2/exports/:jobId", adminRequired, (c) => {
    const jobId = c.req.param("jobId");
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
  });

  router.get("/backup/v2/exports/:jobId/download", adminRequired, async (c) => {
    const jobId = c.req.param("jobId");
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

    const user = c.get("user");
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "backup.export.download",
      resourceType: "system",
      resourceId: "database",
      resourceName: "database-backup-export",
      detail: { jobId, artifact: artifactParam },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
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
  });

  router.delete("/backup/v2/exports/:jobId", adminRequired, async (c) => {
    const jobId = c.req.param("jobId");
    const removed = await cancelOrDiscardExportJob(jobId);
    if (!removed)
      throw new NotFoundError("Export job", jobId);
    return c.json({ success: true });
  });

  return router;
}
