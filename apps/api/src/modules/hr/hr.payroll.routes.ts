import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
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

// Auth: the parent `hrRoutes()` router applies `authRequired` to everything
// mounted under it; access is owned by the protected router's module gate
// (non-admins need the `hr` module on their global role, admins bypass).
export function hrPayrollRoutes() {
  const router = new Hono<ProtectedEnv>();

  // ── /hr/payroll — payroll record management ──

  router.get("/hr/payroll", async (c) => {
    const db = c.get("db");
    const query = listQuerySchema.parse(c.req.query());
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
  });

  router.post("/hr/payroll", async (c) => {
    const db = c.get("db");
    const body = createBodySchema.parse(await c.req.json());
    const created = await createPayrollRecord(db, body);
    return c.json({ success: true, data: created }, 201);
  });

  // Pending-only; `status: "paid"` marks the record paid (stamps `paidAt`).
  router.patch("/hr/payroll/:id", async (c) => {
    const db = c.get("db");
    const body = updateBodySchema.parse(await c.req.json());
    const updated = await updatePayrollRecord(db, c.req.param("id"), body);
    return c.json({ success: true, data: updated });
  });

  // Paid records are immutable history; only pending records can be deleted.
  router.delete("/hr/payroll/:id", async (c) => {
    const db = c.get("db");
    await deletePayrollRecord(db, c.req.param("id"));
    return c.json({ success: true });
  });

  return router;
}
