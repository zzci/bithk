import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
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
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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

// Auth: the parent `hrRoutes()` router applies `authRequired` to everything
// mounted under it; each route here adds the admin gate.
export function hrApprovalsRoutes() {
  const router = new Hono<ProtectedEnv>();

  // ── /hr/approvals — admin-only approval request management ──

  router.get("/hr/approvals", adminRequired, async (c) => {
    const db = c.get("db");
    const query = listQuerySchema.parse(c.req.query());
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
  });

  router.post("/hr/approvals", adminRequired, async (c) => {
    const db = c.get("db");
    const body = createBodySchema.parse(await c.req.json());
    const created = await createApproval(db, body);
    return c.json({ success: true, data: created }, 201);
  });

  // Only pending requests are editable; decided records return 409.
  router.patch("/hr/approvals/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const body = updateBodySchema.parse(await c.req.json());
    const updated = await updateApproval(db, c.req.param("id"), body);
    return c.json({ success: true, data: updated });
  });

  router.post("/hr/approvals/:id/decision", adminRequired, async (c) => {
    const db = c.get("db");
    const body = decisionBodySchema.parse(await c.req.json());
    const decided = await decideApproval(db, c.req.param("id"), {
      status: body.status,
      ...body.note !== undefined ? { note: body.note } : {},
      deciderId: c.get("user").id,
    });
    return c.json({ success: true, data: decided });
  });

  // Withdraw a pending request; decided records are immutable history.
  router.delete("/hr/approvals/:id", adminRequired, async (c) => {
    const db = c.get("db");
    await deleteApproval(db, c.req.param("id"));
    return c.json({ success: true });
  });

  return router;
}
