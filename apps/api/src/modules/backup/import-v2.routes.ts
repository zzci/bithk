/**
 * Backup v2 IMPORT routes (PLAN-075 R2/R3/R6, Phases 2 + 3) — admin-only:
 *
 *   POST   /backup/v2/imports                  multipart upload → validate →
 *                                              stage → dry-run → { importId, report }
 *   GET    /backup/v2/imports/:importId        poll state + dry-run report +
 *                                              final apply result / error
 *   POST   /backup/v2/imports/:importId/apply  apply the staged import
 *                                              ({ mode: merge|replace,
 *                                              includeUsers? }) → 202; result
 *                                              via the poll route
 *   DELETE /backup/v2/imports/:importId        discard a staged import
 */
import type { ProtectedEnv } from "@/shared/lib/types";
import { rmSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { startImportApply } from "./import-apply";
import {
  discardImportJob,
  getImportJob,
  prepareImport,
  registerImportJob,
} from "./import.service";

/** Multipart framing overhead allowed on top of the archive cap. */
export const CONTENT_LENGTH_SLACK = 64 * 1024;

const applyBodySchema = z.object({
  mode: z.enum(["merge", "replace"]),
  includeUsers: z.boolean().optional(),
});

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
      result: job.result ?? null,
      error: job.error ?? null,
    });
  });

  router.post("/backup/v2/imports/:importId/apply", adminRequired, async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const importId = c.req.param("importId");
    const job = getImportJob(importId);
    if (!job)
      throw new NotFoundError("Import", importId);

    const body = await c.req.json().catch(() => undefined) as unknown;
    const parsed = applyBodySchema.safeParse(body);
    if (!parsed.success)
      throw new AppError("apply body must be { mode: \"merge\" | \"replace\", includeUsers?: boolean }", 400, "INVALID_APPLY_MODE");

    await startImportApply(db, job, {
      mode: parsed.data.mode,
      includeUsers: parsed.data.includeUsers ?? false,
      actor: {
        id: user.id,
        name: user.name,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
      },
    }, c.get("logger"));

    return c.json({ importId: job.id, state: job.state }, 202);
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
