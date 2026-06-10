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
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { restoreBlobArchive } from "./blob-restore";
import { CONTENT_LENGTH_SLACK } from "./import-v2.routes";

export function backupBlobRestoreRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.post("/backup/v2/blob-restores", adminRequired, async (c) => {
    const db = c.get("db");
    const config = c.get("config");
    const user = c.get("user");

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
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
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
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    }, { critical: true });

    return c.json({ report });
  });

  return router;
}
