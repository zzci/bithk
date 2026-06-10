/**
 * Backup v2 IMPORT routes (PLAN-075 R2/R6, Phase 2) — admin-only upload /
 * status / discard:
 *
 *   POST   /backup/v2/imports             multipart upload → validate →
 *                                         stage → dry-run → { importId, report }
 *   GET    /backup/v2/imports/:importId   poll state + report
 *   DELETE /backup/v2/imports/:importId   discard a staged import
 *
 * The apply route (`POST /:importId/apply`) is Phase 3; nothing here writes
 * to live data — the dry-run transaction always rolls back.
 */
import type { ProtectedEnv } from "@/shared/lib/types";
import { rmSync } from "node:fs";
import { Hono } from "hono";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  discardImportJob,
  getImportJob,
  prepareImport,
  registerImportJob,
} from "./import.service";

/** Multipart framing overhead allowed on top of the archive cap. */
const CONTENT_LENGTH_SLACK = 64 * 1024;

export function backupImportV2Routes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.post("/backup/v2/imports", adminRequired, async (c) => {
    const db = c.get("db");
    const config = c.get("config");
    const user = c.get("user");

    // Cheap early reject on the declared size; the count while staging is
    // the real enforcement (Content-Length can lie).
    const declared = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > config.BACKUP_IMPORT_MAX_ARCHIVE_BYTES + CONTENT_LENGTH_SLACK)
      throw new AppError(`Backup archive exceeds the ${config.BACKUP_IMPORT_MAX_ARCHIVE_BYTES}-byte upload cap`, 400, "ARCHIVE_TOO_LARGE");

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File))
      throw new AppError("No file uploaded", 400, "NO_FILE");

    const job = await prepareImport(db, config, file);

    // Critical, v1 pattern: a failed audit write fails the action — the
    // staged upload is discarded and the job is never registered.
    try {
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "backup.import.validate",
        resourceType: "system",
        resourceId: "database",
        resourceName: "database-backup-import",
        detail: {
          importId: job.id,
          modules: job.manifest.modules.map(m => m.name),
          totals: job.report.totals,
        },
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      }, { critical: true });
    }
    catch (err) {
      discardImportJobQuietly(job.stagingDir);
      throw err;
    }

    registerImportJob(job);
    return c.json({ importId: job.id, report: job.report }, 201);
  });

  router.get("/backup/v2/imports/:importId", adminRequired, (c) => {
    const importId = c.req.param("importId");
    const job = getImportJob(importId);
    if (!job)
      throw new NotFoundError("Import", importId);
    return c.json({
      importId: job.id,
      state: job.state,
      createdAt: job.createdAt,
      report: job.report,
      error: job.error ?? null,
    });
  });

  router.delete("/backup/v2/imports/:importId", adminRequired, (c) => {
    const importId = c.req.param("importId");
    if (!discardImportJob(importId))
      throw new NotFoundError("Import", importId);
    return c.json({ success: true });
  });

  return router;
}

/** The job was never registered; only the staging directory exists. */
function discardImportJobQuietly(stagingDir: string): void {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  catch {
    // Best-effort — the TTL sweep reclaims leftovers.
  }
}
