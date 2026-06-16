import type { ProtectedEnv } from "@/shared/lib/types";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { BUILD_INFO } from "@/build-info";
import { getLodeSummary } from "@/lode";
import { getAppSetting } from "@/shared/lib/app-config";
import { renderPrometheus } from "@/shared/lib/metrics";
import { describeRoute, ErrorEnvelope, resolver } from "@/shared/lib/openapi";
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
});

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
        },
      });
    },
  );

  return router;
}
