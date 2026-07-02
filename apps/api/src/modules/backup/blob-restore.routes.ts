/**
 * Backup v2 standalone BLOB RESTORE route (PLAN-075 R7 import side, Phase 3):
 *
 *   POST /backup/v2/blob-restores   multipart upload of a `blobs.tar.gz`
 *                                   (R7 separate export) → synchronous
 *                                   validate + import + reconcile → report
 *
 * No staged data import is required and the archive carries no manifest (by
 * design). Validation, caps, and the blobs-only allowlist live in
 * `blob-restore.ts`; uploads of data archives are rejected there with a
 * cross-endpoint hint. Idempotent: re-uploading yields all `skippedExisting`.
 */
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { AppError } from "@/shared/lib/errors";
import { describeRoute, errorJson, resolver } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { restoreBlobArchive } from "./blob-restore";
import { CONTENT_LENGTH_SLACK } from "./import-v2.routes";

const blobRestoreReportSchema = z.object({
  written: z.number(),
  skippedExisting: z.number(),
  failed: z.number(),
  unquarantined: z.number(),
  reconcile: z.object({ checked: z.number(), quarantined: z.number() }),
});

export function backupBlobRestoreRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.post(
    "/backup/v2/blob-restores",
    describeRoute({
      tags: ["infra2"],
      summary: "Restore a separate blobs archive (multipart upload)",
      requestBody: { content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } },
      responses: {
        200: { description: "Success", content: { "application/json": { schema: resolver(z.object({ report: blobRestoreReportSchema })) } } },
        400: { description: "Archive too large / no file", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      const config = c.get("config");

      // Cheap early reject on the declared size; the count while staging is
      // the real enforcement (Content-Length can lie).
      const declared = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > config.BACKUP_IMPORT_MAX_ARCHIVE_BYTES + CONTENT_LENGTH_SLACK)
        throw new AppError(`Blob archive exceeds the ${config.BACKUP_IMPORT_MAX_ARCHIVE_BYTES}-byte upload cap`, 400, "ARCHIVE_TOO_LARGE");

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File))
        throw new AppError("No file uploaded", 400, "NO_FILE");

      const report = await restoreBlobArchive(db, config, file, {}, c.get("logger"));

      // Critical, v1 pattern: a failed audit write fails the action loudly.
      await auditFromCtx(c, {
        action: "backup.import.blobs",
        resourceType: "system",
        resourceId: "database",
        resourceName: "database-blob-restore",
        detail: {
          written: report.written,
          skippedExisting: report.skippedExisting,
          failed: report.failed,
          unquarantined: report.unquarantined,
          reconcile: { checked: report.reconcile.checked, quarantined: report.reconcile.quarantined },
        },
        result: "success",
      }, { critical: true });

      return c.json({ report });
    },
  );

  return router;
}
