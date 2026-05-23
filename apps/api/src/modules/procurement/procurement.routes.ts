import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { mountItemCommentRoutes } from "@/modules/item/comment.routes";
import { canViewProcurement, getRole, resolveProjectId } from "@/modules/project/project.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { NotFoundError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import {
  changeStatus,
  createProcurement,
  getProcurementByShortId,
  listByProject,
  resolveProcurementItem,
  softDeleteProcurement,
  updateProcurement,
} from "./procurement.service";
import { PROCUREMENT_STATUSES } from "./schema";

const createSchema = z.object({
  itemName: z.string().min(1).max(500),
  title: z.string().min(1).max(500).optional(),
  status: z.enum(PROCUREMENT_STATUSES).optional(),
  supplierMemberId: z.string().min(1).nullable().optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().nullable().optional(),
  amount: z.number().int().nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  itemName: z.string().min(1).max(500).optional(),
  supplierMemberId: z.string().min(1).nullable().optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().nullable().optional(),
  amount: z.number().int().nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), {
  message: "At least one field must be provided",
});

const statusSchema = z.object({
  status: z.enum(PROCUREMENT_STATUSES),
});

function actorId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

function auditMeta(c: Context<AppEnv>) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

/**
 * Resolve the project ULID from its short id and assert the actor may view
 * procurements on it. Fail-closed: a missing project, a non-member, or a
 * member without procurement visibility all surface as 404 so neither the
 * project's existence nor its procurement list/detail leaks. The pm role
 * passes implicitly (canViewProcurement returns true for pm).
 */
async function requireProcurementAccess(c: Context<AppEnv>, projectShortId: string): Promise<string> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, projectShortId);
  if (!projectId)
    throw new NotFoundError("Project", projectShortId);
  // App admins bypass project membership and the procurement grant entirely.
  if (c.get("user")!.role === "admin")
    return projectId;
  const role = await getRole(db, projectId, actorId(c));
  if (role === null)
    throw new NotFoundError("Project", projectShortId);
  const canView = await canViewProcurement(db, projectId, actorId(c));
  if (!canView)
    throw new NotFoundError("Project", projectShortId);
  return projectId;
}

/**
 * Resolve a procurement short id within a project the actor may view, asserting
 * the procurement belongs to that project. Returns the project ULID and the
 * procurement row. Fail-closed 404 on any mismatch.
 */
async function requireProcurement(c: Context<AppEnv>, projectShortId: string, procurementShortId: string) {
  const projectId = await requireProcurementAccess(c, projectShortId);
  const db = c.get("db");
  const procurement = await getProcurementByShortId(db, procurementShortId);
  // `procurement.projectId` is the project short_id (the external identifier),
  // so it must match the URL's `:projectId` short id.
  if (!procurement || procurement.projectId !== projectShortId)
    throw new NotFoundError("Procurement", procurementShortId);
  return { projectId, procurement };
}

export function procurementRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // ─── List ──────────────────────────────────────────────────────────
  router.get("/projects/:projectId/procurements", async (c) => {
    const projectId = await requireProcurementAccess(c, c.req.param("projectId"));
    const db = c.get("db");
    const status = c.req.query("status");
    const page = Math.max(1, Math.floor(Number.parseInt(c.req.query("page") ?? "", 10)) || 1);
    const limit = Math.min(100, Math.max(1, Math.floor(Number.parseInt(c.req.query("limit") ?? "", 10)) || 20));
    const result = await listByProject(db, projectId, { status, page, limit });
    return c.json({
      success: true,
      data: result.data,
      meta: { total: result.total, page, limit },
    });
  });

  // ─── Create ────────────────────────────────────────────────────────
  router.post("/projects/:projectId/procurements", async (c) => {
    const projectId = await requireProcurementAccess(c, c.req.param("projectId"));
    const db = c.get("db");
    const body = createSchema.parse(await c.req.json());
    const procurement = await createProcurement(db, { ...body, projectId, creatorId: actorId(c) });
    return c.json({ success: true, data: procurement }, 201);
  });

  // ─── Detail ────────────────────────────────────────────────────────
  router.get("/projects/:projectId/procurements/:id", async (c) => {
    const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"));
    return c.json({ success: true, data: procurement });
  });

  // ─── Update ────────────────────────────────────────────────────────
  router.patch("/projects/:projectId/procurements/:id", async (c) => {
    const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"));
    const db = c.get("db");
    const body = updateSchema.parse(await c.req.json());
    const updated = await updateProcurement(db, procurement.id, body);
    if (!updated)
      throw new NotFoundError("Procurement", procurement.id);
    return c.json({ success: true, data: updated });
  });

  // ─── Delete (soft) ─────────────────────────────────────────────────
  router.delete("/projects/:projectId/procurements/:id", async (c) => {
    const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"));
    const db = c.get("db");
    await softDeleteProcurement(db, procurement.id);
    return c.json({ success: true, data: null });
  });

  // ─── Status change ─────────────────────────────────────────────────
  router.post("/projects/:projectId/procurements/:id/status", async (c) => {
    const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"));
    const db = c.get("db");
    const user = c.get("user")!;
    const body = statusSchema.parse(await c.req.json());
    const updated = await changeStatus(
      db,
      c.get("logger"),
      procurement.id,
      body.status,
      { id: user.id, name: user.name },
      auditMeta(c),
    );
    if (!updated)
      throw new NotFoundError("Procurement", procurement.id);
    return c.json({ success: true, data: updated });
  });

  // ─── Comments + attachments (delegated to mod-item) ───────────────
  mountItemCommentRoutes(router, {
    routePrefix: "/projects/:projectId/procurements",
    resourceType: "procurement",
    async resolve(db, idParam) {
      const procurement = await getProcurementByShortId(db, idParam);
      if (!procurement)
        return null;
      const item = await resolveProcurementItem(db, idParam);
      if (!item)
        return null;
      return { item, resource: procurement, externalId: idParam, resourceName: procurement.itemName };
    },
    async permissions(db, user, subject) {
      // Visibility is enforced by the project membership + canViewProcurement
      // gate. Anyone who can view a procurement can read and post comments on
      // it; admins bypass; authors (and admins) may delete their own comments.
      const procurement = subject.resource as { projectId: string };
      // `procurement.projectId` is the project short_id; the membership helpers
      // key on the internal ULID, so resolve it first.
      const projectId = await resolveProjectId(db, procurement.projectId);
      const isAdmin = user.role === "admin";
      if (!projectId) {
        return {
          canRead: isAdmin,
          canPost: isAdmin,
          includeInternal: isAdmin,
          canDelete: authorId => isAdmin || authorId === user.id,
        };
      }
      const role = await getRole(db, projectId, user.id);
      const canView = isAdmin || (role !== null && await canViewProcurement(db, projectId, user.id));
      return {
        canRead: canView,
        canPost: canView,
        includeInternal: canView,
        canDelete: authorId => isAdmin || authorId === user.id,
      };
    },
  });

  return router;
}
