import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { setSetting } from "@/modules/settings/settings.service";
import { AppError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { optionalPageQueryFields } from "@/shared/lib/pagination";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { applyStorageConfig, readStorageConfig, STORAGE_SETTING_KEYS } from "./storage-config";
import { listStorageFiles, syncNonSpreadsheetsToS3 } from "./storage.service";
import { isS3Configured } from "./storage/s3";

const s3ConfigSchema = z.object({
  bucket: z.string(),
  region: z.string(),
  endpoint: z.string(),
  accessKeyId: z.string(),
  prefix: z.string(),
  secretConfigured: z.boolean(),
});
const configResponseSchema = z.object({
  uploadDriver: z.enum(["s3", "local"]),
  s3: s3ConfigSchema,
});

// The secret is write-only: absent/empty leaves the stored value unchanged.
const putConfigSchema = z.object({
  uploadDriver: z.enum(["s3", "local"]),
  s3: z.object({
    bucket: z.string().max(255).optional(),
    region: z.string().max(255).optional(),
    endpoint: z.string().max(1024).optional(),
    accessKeyId: z.string().max(255).optional(),
    secret: z.string().max(4096).optional(),
    prefix: z.string().max(255).optional(),
  }).optional(),
});

const filesQuerySchema = z.object({
  ...optionalPageQueryFields(100),
});

const storageFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  entryId: z.string().nullable(),
  ownerScope: z.string().nullable(),
  mimetype: z.string(),
  size: z.number(),
  storageDriver: z.string(),
  uploadedByName: z.string(),
  createdAt: z.string().nullable(),
});
const syncSummarySchema = z.object({
  moved: z.number(),
  skipped: z.number(),
  failed: z.number(),
});

/**
 * Admin Storage module (FEAT-047): view / edit the DB-backed storage config
 * (upload driver + S3 params, secret write-only), list server files, and sync
 * non-spreadsheet data to S3. All routes are admin-only.
 */
export function storageRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // GET /admin/storage/config — current config (secret never returned).
  router.get(
    "/admin/storage/config",
    describeRoute({
      tags: ["infra1"],
      summary: "Get storage config",
      responses: {
        200: okJson(configResponseSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      const cfg = await readStorageConfig(db);
      return c.json({
        success: true,
        data: {
          uploadDriver: cfg.uploadDriver,
          s3: {
            bucket: cfg.s3.bucket,
            region: cfg.s3.region,
            endpoint: cfg.s3.endpoint,
            accessKeyId: cfg.s3.accessKeyId,
            prefix: cfg.s3.prefix,
            secretConfigured: cfg.s3.secret.length > 0,
          },
        },
      });
    },
  );

  // PUT /admin/storage/config — update; secret preserved when omitted/empty.
  router.put(
    "/admin/storage/config",
    describeRoute({
      tags: ["infra1"],
      summary: "Update storage config",
      responses: {
        200: okJson(z.null()),
        400: { description: "Missing required S3 params", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("json", putConfigSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const body = c.req.valid("json");
      const s3 = body.s3 ?? {};

      // Existing stored config so we can validate against the already-saved
      // secret and only rewrite the secret when a new value is supplied.
      const current = await readStorageConfig(db);
      const newSecret = (s3.secret ?? "").trim();
      const effectiveSecret = newSecret || current.s3.secret;
      const effectiveBucket = s3.bucket ?? current.s3.bucket;
      const effectiveAccessKeyId = s3.accessKeyId ?? current.s3.accessKeyId;

      if (body.uploadDriver === "s3") {
        const missing = ([
          ["bucket", effectiveBucket],
          ["accessKeyId", effectiveAccessKeyId],
          ["secret", effectiveSecret],
        ] as const).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length > 0) {
          throw new AppError(`S3 upload driver requires ${missing.join(", ")}`, 400, "STORAGE_CONFIG_INCOMPLETE");
        }
      }

      await setSetting(db, STORAGE_SETTING_KEYS.uploadDriver, body.uploadDriver, { updatedBy: user.id });
      if (s3.bucket !== undefined)
        await setSetting(db, STORAGE_SETTING_KEYS.s3Bucket, s3.bucket, { updatedBy: user.id });
      if (s3.region !== undefined)
        await setSetting(db, STORAGE_SETTING_KEYS.s3Region, s3.region, { updatedBy: user.id });
      if (s3.endpoint !== undefined)
        await setSetting(db, STORAGE_SETTING_KEYS.s3Endpoint, s3.endpoint, { updatedBy: user.id });
      if (s3.accessKeyId !== undefined)
        await setSetting(db, STORAGE_SETTING_KEYS.s3AccessKeyId, s3.accessKeyId, { updatedBy: user.id });
      if (s3.prefix !== undefined)
        await setSetting(db, STORAGE_SETTING_KEYS.s3Prefix, s3.prefix, { updatedBy: user.id });
      // Only rewrite the secret when a non-empty value was submitted.
      if (newSecret)
        await setSetting(db, STORAGE_SETTING_KEYS.s3Secret, newSecret, { updatedBy: user.id });

      // Apply the new config to the running drivers (no restart needed).
      await applyStorageConfig(db);

      await auditFromCtx(c, {
        action: "storage.config.updated",
        resourceType: "storage",
        resourceId: "config",
        resourceName: "storage config",
        detail: {
          uploadDriver: body.uploadDriver,
          bucket: effectiveBucket,
          region: s3.region ?? current.s3.region,
          endpoint: s3.endpoint ?? current.s3.endpoint,
          accessKeyId: effectiveAccessKeyId,
          prefix: s3.prefix ?? current.s3.prefix,
          secretChanged: Boolean(newSecret),
        },
        result: "success",
      });

      return c.json({ success: true, data: null });
    },
  );

  // GET /admin/storage/files — paginated file list.
  router.get(
    "/admin/storage/files",
    describeRoute({
      tags: ["infra1"],
      summary: "List server files",
      responses: {
        200: okListJson(storageFileSchema, "Files page"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    validator("query", filesQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { page: pageRaw, limit: limitRaw } = c.req.valid("query");
      const page = pageRaw ?? 1;
      const limit = limitRaw ?? 20;
      const result = await listStorageFiles(db, page, limit);
      return c.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    },
  );

  // POST /admin/storage/sync-to-s3 — move non-spreadsheet data to S3.
  router.post(
    "/admin/storage/sync-to-s3",
    describeRoute({
      tags: ["infra1"],
      summary: "Sync non-spreadsheet data to S3",
      responses: {
        200: okJson(syncSummarySchema),
        400: { description: "S3 not configured", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      if (!isS3Configured()) {
        throw new AppError("S3 storage is not configured", 400, "STORAGE_S3_NOT_CONFIGURED");
      }
      const summary = await syncNonSpreadsheetsToS3(db);

      await auditFromCtx(c, {
        action: "storage.sync_to_s3",
        resourceType: "storage",
        resourceId: "sync",
        resourceName: "sync to s3",
        detail: { ...summary },
        result: "success",
      });

      return c.json({ success: true, data: summary });
    },
  );

  return router;
}
