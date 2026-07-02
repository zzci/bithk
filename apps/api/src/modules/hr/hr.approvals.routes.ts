import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, pageMetaSchema, resolver, validator } from "@/shared/lib/openapi";
import { pageQueryFields } from "@/shared/lib/pagination";
import { adminRequired } from "@/shared/middleware/auth";
import {
  createApproval,
  decideApproval,
  deleteApproval,
  listApprovals,
  updateApproval,
} from "./hr.approvals.service";
import { HR_APPROVAL_STATUSES, HR_APPROVAL_TYPES } from "./schema";

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(HR_APPROVAL_STATUSES).optional(),
  type: z.enum(HR_APPROVAL_TYPES).optional(),
  ...pageQueryFields({ defaultLimit: 20, maxLimit: 100 }),
});

const createBodySchema = z.object({
  colleagueId: z.string().min(1).max(100),
  type: z.enum(HR_APPROVAL_TYPES),
  title: z.string().min(1).max(200),
  reason: z.string().max(2000).optional(),
});

const updateBodySchema = z.object({
  colleagueId: z.string().min(1).max(100).optional(),
  type: z.enum(HR_APPROVAL_TYPES).optional(),
  title: z.string().min(1).max(200).optional(),
  reason: z.string().max(2000).optional(),
}).refine(
  d => Object.values(d).some(v => v !== undefined),
  { message: "At least one field must be provided" },
);

// Deciding is a one-way transition, so it gets its own endpoint instead of
// being a writable `status` field on PATCH.
const decisionBodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional(),
});

const idParamSchema = z.object({ id: z.string() });

// Response data shape (mirrors the service view) for the generated spec.
const approvalViewSchema = z.object({
  id: z.string(),
  colleagueId: z.string(),
  type: z.enum(HR_APPROVAL_TYPES),
  title: z.string(),
  reason: z.string().nullable(),
  status: z.enum(HR_APPROVAL_STATUSES),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  decidedByName: z.string().nullable(),
  applicant: z.object({
    name: z.string(),
    username: z.string(),
    isVirtual: z.boolean(),
  }),
});
const hrPageMetaSchema = pageMetaSchema.extend({ totalPages: z.number() });

// Withdraw returns a bare `{ success:true }` with no data payload.
const okEmpty = { description: "Success", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } } };

// Auth: the parent `hrRoutes()` router applies `authRequired` to everything
// mounted under it; access is owned by the protected router's module gate
// (non-admins need the `hr` module on their global role, admins bypass).
export function hrApprovalsRoutes() {
  const router = new Hono<ProtectedEnv>();

  // ── /hr/approvals — approval request management ──

  router.get(
    "/hr/approvals",
    describeRoute({
      tags: ["hr"],
      summary: "List approval requests",
      responses: {
        200: okListJson(approvalViewSchema, "Success", hrPageMetaSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const query = c.req.valid("query");
      const result = await listApprovals(db, {
        ...query.q ? { q: query.q } : {},
        ...query.status ? { status: query.status } : {},
        ...query.type ? { type: query.type } : {},
        page: query.page,
        limit: query.limit,
      });
      return c.json({
        success: true,
        data: result.data,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    },
  );

  router.post(
    "/hr/approvals",
    describeRoute({
      tags: ["hr"],
      summary: "Create an approval request",
      responses: {
        201: okJson(approvalViewSchema, "Created"),
        400: { description: "Colleague not active", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("json", createBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const created = await createApproval(db, body);
      return c.json({ success: true, data: created }, 201);
    },
  );

  // Only pending requests are editable; decided records return 409.
  router.patch(
    "/hr/approvals/:id",
    describeRoute({
      tags: ["hr"],
      summary: "Update a pending approval request",
      responses: {
        200: okJson(approvalViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Already decided", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const updated = await updateApproval(db, id, body);
      return c.json({ success: true, data: updated });
    },
  );

  // Deciding an approval is admin-only; the module gate already guards reads.
  router.post(
    "/hr/approvals/:id/decision",
    describeRoute({
      tags: ["hr"],
      summary: "Decide an approval request",
      responses: {
        200: okJson(approvalViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Already decided", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", decisionBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const decided = await decideApproval(db, id, {
        status: body.status,
        ...body.note !== undefined ? { note: body.note } : {},
        deciderId: c.get("user").id,
      });
      return c.json({ success: true, data: decided });
    },
  );

  // Withdraw a pending request; decided records are immutable history.
  router.delete(
    "/hr/approvals/:id",
    describeRoute({
      tags: ["hr"],
      summary: "Withdraw a pending approval request",
      responses: {
        200: okEmpty,
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Already decided", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      await deleteApproval(db, id);
      return c.json({ success: true });
    },
  );

  return router;
}
