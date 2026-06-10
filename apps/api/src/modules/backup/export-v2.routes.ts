/**
 * Backup v2 EXPORT routes (PLAN-075 R1/R6) — admin-only async-job flavour
 * of the v1 streaming export:
 *
 *   POST   /backup/v2/exports               start a server-side export job
 *   GET    /backup/v2/exports/:jobId        poll state + progress
 *   GET    /backup/v2/exports/:jobId/download   stream the finished archive
 *   DELETE /backup/v2/exports/:jobId        cancel running / discard finished
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
      includeBlobs: z.boolean().default(true),
    }).parse(await c.req.json());

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
      detail: { modules: body.modules, includeBlobs: body.includeBlobs, via: "admin" },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    }, { critical: true });

    const job = startExportJob(db, c.get("config"), { modules: body.modules, includeBlobs: body.includeBlobs }, c.get("logger"));
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
      includeBlobs: job.includeBlobs,
      createdAt: job.createdAt,
      progress: job.progress,
      error: job.error ?? null,
      archiveSize: job.archiveSize ?? null,
    });
  });

  router.get("/backup/v2/exports/:jobId/download", adminRequired, async (c) => {
    const jobId = c.req.param("jobId");
    // 404 until `completed` — a running job's `.partial` is never served.
    const archive = getDownloadableArchive(jobId);
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
      detail: { jobId },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    }, { critical: true });

    // Pull-based wrapper (backpressure for multi-GB archives) that marks
    // the job downloaded + removes staging only after the body fully
    // drains — a client disconnect keeps the archive so the operator can
    // retry; the TTL sweep reclaims it otherwise.
    const reader = Bun.file(archive.path).stream().getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finalizeDownloadedExport(jobId);
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
    return new Response(body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": buildContentDisposition("attachment", `${c.get("config").APP_NAME}-backup-v2-${timestamp}.tar.gz`),
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
