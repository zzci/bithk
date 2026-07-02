import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { pageQueryFields } from "@/shared/lib/pagination";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { getAuditEventById, listAuditEvents } from "./audit.service";

const isoDatetime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/, "Invalid ISO 8601 datetime");
const RE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Audit `created_at` is stored as a full ISO timestamp. When the operator
 * filters by a date-only `to` (e.g. `to=2026-05-10`), a naive `lte` against
 * the row string compares lexically against `2026-05-10T...Z` and excludes
 * the entire 2026-05-10 day. Normalise to the day's last instant so the
 * inclusive intent matches what the UI shows.
 */
function normaliseToBoundary(value: string | undefined): string | undefined {
  if (value === undefined)
    return undefined;
  return RE_DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value;
}

const auditQuerySchema = z.object({
  actor_id: z.string().optional(),
  action: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  result: z.enum(["success", "failure"]).optional(),
  from: isoDatetime.optional(),
  to: isoDatetime.optional(),
  ...pageQueryFields({ defaultLimit: 50, maxLimit: 200 }),
});

const idParamSchema = z.object({ id: z.string() });

// Mirrors a persisted `audit_events` row (camelCase drizzle select keys).
const auditEventSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  detail: z.string().nullable(),
  ip: z.string(),
  userAgent: z.string(),
  result: z.enum(["success", "failure"]),
  createdAt: z.string(),
});

export function auditRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  router.get(
    "/audit",
    describeRoute({
      tags: ["infra2"],
      summary: "List audit events with filters and pagination",
      responses: {
        200: okListJson(auditEventSchema, "Success"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("query", auditQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const q = c.req.valid("query");

      const { data, total } = await listAuditEvents(db, {
        actorId: q.actor_id,
        action: q.action,
        resourceType: q.resource_type,
        resourceId: q.resource_id,
        result: q.result,
        from: q.from,
        to: normaliseToBoundary(q.to),
        page: q.page,
        limit: q.limit,
      });

      return c.json({
        success: true,
        data,
        meta: {
          total,
          page: q.page,
          limit: q.limit,
        },
      });
    },
  );

  router.get(
    "/audit/:id",
    describeRoute({
      tags: ["infra2"],
      summary: "Get a single audit event by id",
      responses: {
        200: okJson(auditEventSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const event = await getAuditEventById(db, id);
      if (!event) {
        throw new NotFoundError("Audit event", id);
      }
      return c.json({ success: true, data: event });
    },
  );

  return router;
}
