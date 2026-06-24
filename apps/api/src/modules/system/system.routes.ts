import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { BUILD_INFO } from "@/build-info";
import { getLodeSummary, requestLodeRestart, requestLodeRollback, requestLodeUpdate, setLodeHold } from "@/lode";
import { audit } from "@/modules/audit/audit.service";
import { directUploadAvailable } from "@/modules/file";
import { getAppSetting } from "@/shared/lib/app-config";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError } from "@/shared/lib/errors";
import { renderPrometheus } from "@/shared/lib/metrics";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { serviceTokenRequired } from "@/shared/middleware/service-token";

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
// Raw (non-envelope) JSON response doc — the health probes return a bare
// `{ status }` body rather than the app's success envelope.
function rawJson(schema: z.ZodType, description: string) {
  return { description, content: { "application/json": { schema: resolver(schema) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

const statusSchema = z.object({ status: z.string() });
const brandingSchema = z.object({ appDisplayName: z.string() });
const versionSchema = z.object({
  commit: z.string(),
  buildTime: z.string(),
  version: z.string(),
  lode: z.unknown(),
});
const uploadLimitsSchema = z.object({
  maxFileSize: z.number(),
  maxAttachmentsPerResource: z.number(),
  totalQuota: z.number().nullable(),
  // FEAT-044: true when the active storage backend supports presigned direct
  // upload (S3); the web uploader then hashes + uploads straight to S3.
  directUpload: z.boolean(),
});

// A lode version token: a concrete version or the "latest" channel pointer.
const lodeVersion = z.union([
  z.literal("latest"),
  z.string().trim().min(1).max(64).regex(/^[\w.+-]+$/, "must be a version or \"latest\""),
]);
const lodeUpdateSchema = z.object({ target: lodeVersion });
// Rollback to a specific version, or omit to use lode's recorded last_good.
const lodeRollbackSchema = z.object({ version: lodeVersion.optional() });
const lodeHoldSchema = z.object({ hold: z.boolean() });

// All four lode operations are sensitive admin actions — record an audit event.
async function auditLodeAction(c: Context<ProtectedEnv>, action: string, detail: Record<string, unknown>): Promise<void> {
  const user = c.get("user");
  await audit(c.get("db"), c.get("logger"), {
    actorId: user.id,
    actorName: user.name,
    action,
    resourceType: "lode",
    resourceId: "supervisor",
    resourceName: "lode supervisor",
    detail,
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "",
    result: "success",
  });
}

function lodeNotActive(): never {
  throw new AppError("not running under the lode supervisor", 409, "LODE_NOT_ACTIVE");
}

export function systemRoutes() {
  const router = new Hono<ProtectedEnv>();

  // Liveness — k8s livenessProbe / Docker HEALTHCHECK.
  router.get(
    "/health",
    describeRoute({
      tags: ["infra1"],
      summary: "Liveness probe",
      responses: { 200: rawJson(statusSchema, "Service is live") },
    }),
    c => c.json({ status: "ok" }),
  );

  // Readiness — DB reachable. 503 drains traffic.
  router.get(
    "/health/ready",
    describeRoute({
      tags: ["infra1"],
      summary: "Readiness probe",
      responses: {
        200: rawJson(statusSchema, "Service is ready"),
        503: rawJson(statusSchema, "Database unavailable"),
      },
    }),
    async (c) => {
      const db = c.get("db");
      try {
        await db.run(sql`SELECT 1`);
      }
      catch (err) {
        c.get("logger").error({ err }, "readiness probe: db ping failed");
        c.status(503);
        return c.json({ status: "db_unavailable" });
      }
      return c.json({ status: "ready" });
    },
  );

  router.get(
    "/system/branding",
    describeRoute({
      tags: ["infra1"],
      summary: "Public branding",
      responses: { 200: okJson(brandingSchema) },
    }),
    async (c) => {
      const cfg = c.get("config");
      const appDisplayName = await getAppSetting(c.get("db"), "app.display_name", cfg.APP_DISPLAY_NAME, "bit");
      return c.json({
        success: true,
        data: { appDisplayName },
      });
    },
  );

  router.get(
    "/system/version",
    describeRoute({
      tags: ["infra1"],
      summary: "Build version and lode summary",
      responses: {
        200: okJson(versionSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    authRequired,
    adminRequired,
    c => c.json({
      success: true,
      data: {
        ...BUILD_INFO,
        lode: getLodeSummary(),
      },
    }),
  );

  // Restart the running version via lode (also applies a pending lode.toml edit
  // — the relaunch re-reads it). Admin only; 409 when not under lode.
  router.post(
    "/system/lode/restart",
    describeRoute({
      tags: ["infra1"],
      summary: "Restart via lode",
      description: "Bumps state.json `restart_nonce` so lode relaunches the current version (re-reading lode.toml). Admin only.",
      responses: {
        200: okJson(z.object({ status: z.literal("ok"), restartNonce: z.number() }), "Restart requested"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        409: { description: "Not running under lode", ...errorJson },
      },
    }),
    authRequired,
    adminRequired,
    async (c) => {
      const result = requestLodeRestart();
      if (result.status === "not_active")
        lodeNotActive();
      await auditLodeAction(c, "lode.restart", { restartNonce: result.restartNonce });
      return c.json({ success: true, data: { status: "ok", restartNonce: result.restartNonce } });
    },
  );

  // Request an up/down-grade by setting lode's `target` (a version or "latest").
  router.post(
    "/system/lode/update",
    describeRoute({
      tags: ["infra1"],
      summary: "Update via lode",
      description: "Sets state.json `target` so lode resolves, downloads, verifies, and switches to the requested version. Admin only.",
      responses: {
        200: okJson(z.object({ status: z.literal("ok"), target: z.string() }), "Update requested"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        409: { description: "Not running under lode", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    authRequired,
    adminRequired,
    validator("json", lodeUpdateSchema, onValidationFailure),
    async (c) => {
      const { target } = c.req.valid("json");
      const result = requestLodeUpdate(target);
      if (result.status === "not_active")
        lodeNotActive();
      await auditLodeAction(c, "lode.update", { target: result.target });
      return c.json({ success: true, data: { status: "ok", target: result.target } });
    },
  );

  // Roll back to a version, or omit `version` to use lode's recorded last_good.
  router.post(
    "/system/lode/rollback",
    describeRoute({
      tags: ["infra1"],
      summary: "Roll back via lode",
      description: "Sets `target` to the given version, else the recorded `last_good`, so lode switches back. Admin only.",
      responses: {
        200: okJson(z.object({ status: z.literal("ok"), target: z.string() }), "Rollback requested"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        409: { description: "Not running under lode, or no rollback target", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    authRequired,
    adminRequired,
    validator("json", lodeRollbackSchema, onValidationFailure),
    async (c) => {
      const { version } = c.req.valid("json");
      const result = requestLodeRollback(version);
      if (result.status === "not_active")
        lodeNotActive();
      if (result.status === "no_target")
        throw new AppError("no rollback target: lode has not recorded a last-good version", 409, "LODE_NO_ROLLBACK_TARGET");
      await auditLodeAction(c, "lode.rollback", { target: result.target });
      return c.json({ success: true, data: { status: "ok", target: result.target } });
    },
  );

  // Set/clear the maintenance hold — lode stops (re)starting the process.
  router.post(
    "/system/lode/hold",
    describeRoute({
      tags: ["infra1"],
      summary: "Set lode maintenance hold",
      description: "Sets state.json `hold` so lode will NOT (re)start the process (status \"held\"); clear with `hold:false`. Admin only.",
      responses: {
        200: okJson(z.object({ status: z.literal("ok"), hold: z.boolean() }), "Hold updated"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        409: { description: "Not running under lode", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    authRequired,
    adminRequired,
    validator("json", lodeHoldSchema, onValidationFailure),
    async (c) => {
      const { hold } = c.req.valid("json");
      const result = setLodeHold(hold);
      if (result.status === "not_active")
        lodeNotActive();
      await auditLodeAction(c, "lode.hold", { hold: result.hold });
      return c.json({ success: true, data: { status: "ok", hold: result.hold } });
    },
  );

  router.get(
    "/metrics",
    describeRoute({
      tags: ["infra1"],
      summary: "Prometheus metrics",
      responses: {
        200: { description: "Prometheus exposition text", content: { "text/plain": { schema: resolver(z.string()) } } },
        401: { description: "Invalid service token", ...errorJson },
        503: { description: "Metrics token not configured", ...errorJson },
      },
    }),
    serviceTokenRequired("metrics"),
    (c) => {
      return c.text(renderPrometheus(), 200, { "Content-Type": "text/plain; version=0.0.4" });
    },
  );

  router.get(
    "/system/upload-limits",
    describeRoute({
      tags: ["infra1"],
      summary: "Upload limits",
      responses: {
        200: okJson(uploadLimitsSchema),
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    authRequired,
    (c) => {
      const cfg = c.get("config");
      return c.json({
        success: true,
        data: {
          maxFileSize: cfg.MAX_UPLOAD_BYTES,
          maxAttachmentsPerResource: cfg.MAX_ATTACHMENTS_PER_RESOURCE,
          totalQuota: cfg.UPLOADS_TOTAL_BYTES > 0 ? cfg.UPLOADS_TOTAL_BYTES : null,
          directUpload: directUploadAvailable(),
        },
      });
    },
  );

  return router;
}
