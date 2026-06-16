import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import {
  createPayrollRecord,
  deletePayrollRecord,
  listPayrollRecords,
  updatePayrollRecord,
} from "./hr.payroll.service";
import { HR_PAYROLL_STATUSES } from "./schema";

// `YYYY-MM` with a real month — no day component, so records are unambiguous
// per month.
const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "Period must be YYYY-MM");

// 3-letter uppercase ISO-style code; validated by format (not an enum) so
// new currencies never need a schema change.
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase code");

const amountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const listQuerySchema = z.object({
  colleagueId: z.string().max(100).optional(),
  period: periodSchema.optional(),
  status: z.enum(HR_PAYROLL_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createBodySchema = z.object({
  colleagueId: z.string().min(1).max(100),
  period: periodSchema,
  baseSalary: amountSchema,
  bonus: amountSchema.optional(),
  deduction: amountSchema.optional(),
  currency: currencySchema,
  notes: z.string().max(2000).optional(),
});

const updateBodySchema = z.object({
  colleagueId: z.string().min(1).max(100).optional(),
  period: periodSchema.optional(),
  baseSalary: amountSchema.optional(),
  bonus: amountSchema.optional(),
  deduction: amountSchema.optional(),
  currency: currencySchema.optional(),
  notes: z.string().max(2000).optional(),
  // Only the one-way pending -> paid transition is accepted here.
  status: z.literal("paid").optional(),
}).refine(
  d => Object.values(d).some(v => v !== undefined),
  { message: "At least one field must be provided" },
);

const idParamSchema = z.object({ id: z.string() });

// Response data shape (mirrors the service view) for the generated spec.
const payrollViewSchema = z.object({
  id: z.string(),
  colleagueId: z.string(),
  period: z.string(),
  baseSalary: z.number(),
  bonus: z.number(),
  deduction: z.number(),
  currency: z.string(),
  netAmount: z.number(),
  status: z.enum(HR_PAYROLL_STATUSES),
  paidAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  colleague: z.object({
    name: z.string(),
    username: z.string(),
    isVirtual: z.boolean(),
  }),
});
const pageMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };
// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
// `{ success:true, data:[…], meta }` response doc for a paginated list.
function paginatedJson(itemSchema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: z.array(itemSchema), meta: pageMetaSchema })) } } };
}
// Delete returns a bare `{ success:true }` with no data payload.
const okEmpty = { description: "Success", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } } };

// Auth: the parent `hrRoutes()` router applies `authRequired` to everything
// mounted under it; access is owned by the protected router's module gate
// (non-admins need the `hr` module on their global role, admins bypass).
export function hrPayrollRoutes() {
  const router = new Hono<ProtectedEnv>();

  // ── /hr/payroll — payroll record management ──

  router.get(
    "/hr/payroll",
    describeRoute({
      tags: ["hr"],
      summary: "List payroll records",
      responses: {
        200: paginatedJson(payrollViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const query = c.req.valid("query");
      const result = await listPayrollRecords(db, {
        ...query.colleagueId ? { colleagueId: query.colleagueId } : {},
        ...query.period ? { period: query.period } : {},
        ...query.status ? { status: query.status } : {},
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
    "/hr/payroll",
    describeRoute({
      tags: ["hr"],
      summary: "Create a payroll record",
      responses: {
        201: okJson(payrollViewSchema, "Created"),
        400: { description: "Invalid payroll input", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Duplicate period", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("json", createBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const created = await createPayrollRecord(db, body);
      return c.json({ success: true, data: created }, 201);
    },
  );

  // Pending-only; `status: "paid"` marks the record paid (stamps `paidAt`).
  router.patch(
    "/hr/payroll/:id",
    describeRoute({
      tags: ["hr"],
      summary: "Update a pending payroll record",
      responses: {
        200: okJson(payrollViewSchema),
        400: { description: "Invalid payroll input", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Already paid or duplicate period", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const updated = await updatePayrollRecord(db, id, body);
      return c.json({ success: true, data: updated });
    },
  );

  // Paid records are immutable history; only pending records can be deleted.
  router.delete(
    "/hr/payroll/:id",
    describeRoute({
      tags: ["hr"],
      summary: "Delete a pending payroll record",
      responses: {
        200: okEmpty,
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Already paid", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      await deletePayrollRecord(db, id);
      return c.json({ success: true });
    },
  );

  return router;
}
