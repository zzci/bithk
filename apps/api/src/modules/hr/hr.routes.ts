import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { authRequired } from "@/shared/middleware/auth";
import {
  archiveColleague,
  createColleague,
  listColleagues,
  updateColleague,
} from "./hr.service";
import { HR_COLLEAGUE_STATUSES } from "./schema";

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(HR_COLLEAGUE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createBodySchema = z.object({
  userId: z.string().min(1).max(100),
  code: z.string().max(100).optional(),
  title: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const updateBodySchema = z.object({
  userId: z.string().min(1).max(100).optional(),
  code: z.string().max(100).optional(),
  title: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(HR_COLLEAGUE_STATUSES).optional(),
}).refine(
  d => Object.values(d).some(v => v !== undefined),
  { message: "At least one field must be provided" },
);

export function hrRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // ── /hr/colleagues — colleague management ──
  // Access is owned by the protected router's module gate: non-admins need
  // the `hr` module on their global role (the default Member role excludes
  // it), admins bypass. No per-route adminRequired wrap here.

  router.get("/hr/colleagues", async (c) => {
    const db = c.get("db");
    const query = listQuerySchema.parse(c.req.query());
    const result = await listColleagues(db, {
      ...query.q ? { q: query.q } : {},
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

  router.post("/hr/colleagues", async (c) => {
    const db = c.get("db");
    const body = createBodySchema.parse(await c.req.json());
    const created = await createColleague(db, body);
    return c.json({ success: true, data: created }, 201);
  });

  router.patch("/hr/colleagues/:id", async (c) => {
    const db = c.get("db");
    const body = updateBodySchema.parse(await c.req.json());
    const updated = await updateColleague(db, c.req.param("id"), body);
    return c.json({ success: true, data: updated });
  });

  // DELETE archives instead of hard-deleting — see archiveColleague.
  router.delete("/hr/colleagues/:id", async (c) => {
    const db = c.get("db");
    const archived = await archiveColleague(db, c.req.param("id"));
    return c.json({ success: true, data: archived });
  });

  return router;
}
