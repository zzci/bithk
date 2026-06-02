import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { mountItemCommentRoutes } from "@/modules/item/comment.routes";
import { setItemPinned } from "@/modules/item/item.service";
import { hasCapability, isMember as isProjectMember, resolveProjectId } from "@/modules/project/project.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { NotFoundError } from "@/shared/lib/errors";
import { parsePageQuery } from "@/shared/lib/pagination";
import { authRequired } from "@/shared/middleware/auth";
import {
  changeStatus,
  createProcurement,
  getProcurementByShortId,
  listByProject,
  resolveProcurementItem,
  updateProcurement,
} from "./procurement.service";
import { PROCUREMENT_STATUSES } from "./schema";

// Shared priority levels for procurement create / update / list edges.
const PROCUREMENT_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const createSchema = z.object({
  itemName: z.string().min(1).max(500),
  title: z.string().min(1).max(500).optional(),
  status: z.enum(PROCUREMENT_STATUSES).optional(),
  supplierId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
  // Order quantity and cost are physical/monetary amounts: never negative.
  quantity: z.number().int().min(0).nullable().optional(),
  amount: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  // Issue-parity fields. Mirror `issue.routes.ts` create semantics.
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(PROCUREMENT_PRIORITIES).optional(),
  dueDate: z.string().max(30).nullable().optional(),
  // Optional tag names (tag type 'procurement') synced with the procurement.
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  itemName: z.string().min(1).max(500).optional(),
  supplierId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(0).nullable().optional(),
  amount: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  // Issue-parity fields. Mirror `issue.routes.ts` update semantics — a null
  // description / dueDate clears the stored value.
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(PROCUREMENT_PRIORITIES).optional(),
  dueDate: z.string().max(30).nullable().optional(),
  // Replacement tag set (tag type 'procurement'); omit to leave tags unchanged.
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), {
  message: "At least one field must be provided",
});

const statusSchema = z.object({
  status: z.enum(PROCUREMENT_STATUSES),
});

// Bounded list-query schema for the list edge: caps `q` length and validates
// status / priority against their enums (invalid → 422 instead of silently
// dropped). `categoryId` is bounded; pagination uses `parsePageQuery`.
const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(PROCUREMENT_STATUSES).optional(),
  priority: z.enum(PROCUREMENT_PRIORITIES).optional(),
  categoryId: z.string().max(100).optional(),
});

// Parse the repeatable `tagIds` query into a bounded, de-duplicated list.
// Accepts repeated params (?tagIds=a&tagIds=b) and comma-separated values
// (?tagIds=a,b). `tagIds` is untrusted input, so the count is capped.
function parseTagIds(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0)
    return [];
  const out = new Set<string>();
  for (const part of raw) {
    for (const value of part.split(",")) {
      const trimmed = value.trim();
      if (trimmed)
        out.add(trimmed);
    }
  }
  return [...out].slice(0, 50);
}

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
 * project's existence nor its procurement list/detail leaks. `needManage`
 * additionally requires the `procurement.manage` capability for mutations.
 */
async function requireProcurementAccess(c: Context<AppEnv>, projectShortId: string, needManage = false): Promise<string> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, projectShortId);
  if (!projectId)
    throw new NotFoundError("Project", projectShortId);
  // App admins bypass project membership and procurement capabilities entirely.
  if (c.get("user")!.role === "admin")
    return projectId;
  if (!await isProjectMember(db, projectId, actorId(c)))
    throw new NotFoundError("Project", projectShortId);
  // Visibility is fail-closed: lacking `procurement.view` hides the project's
  // procurement entirely (404, same as a non-member) so neither the list nor a
  // detail leaks. Mutations additionally require `procurement.manage`.
  if (!await hasCapability(db, projectId, actorId(c), "procurement.view"))
    throw new NotFoundError("Project", projectShortId);
  if (needManage && !await hasCapability(db, projectId, actorId(c), "procurement.manage"))
    throw new NotFoundError("Project", projectShortId);
  return projectId;
}

/**
 * Resolve a procurement short id within a project the actor may view, asserting
 * the procurement belongs to that project. Returns the project ULID and the
 * procurement row. Fail-closed 404 on any mismatch.
 */
async function requireProcurement(c: Context<AppEnv>, projectShortId: string, procurementShortId: string, needManage = false) {
  const projectId = await requireProcurementAccess(c, projectShortId, needManage);
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
    const { q, status, priority, categoryId } = listQuerySchema.parse({
      q: c.req.query("q") || undefined,
      status: c.req.query("status") || undefined,
      priority: c.req.query("priority") || undefined,
      categoryId: c.req.query("categoryId") || undefined,
    });
    const tagIds = parseTagIds(c.req.queries("tagIds"));
    const { page, limit } = parsePageQuery(c, { limit: 20 });
    const result = await listByProject(db, projectId, { q, status, priority, categoryId, tagIds, page, limit });
    return c.json({
      success: true,
      data: result.data,
      meta: { total: result.total, page, limit },
    });
  });

  // ─── Create ────────────────────────────────────────────────────────
  router.post("/projects/:projectId/procurements", async (c) => {
    const projectId = await requireProcurementAccess(c, c.req.param("projectId"), true);
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
    const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"), true);
    const db = c.get("db");
    const body = updateSchema.parse(await c.req.json());
    const updated = await updateProcurement(db, procurement.id, body);
    if (!updated)
      throw new NotFoundError("Procurement", procurement.id);
    return c.json({ success: true, data: updated });
  });

  // Procurement is intentionally non-deletable: there is no DELETE route. A
  // procurement that is no longer relevant is moved to the `cancelled` status
  // instead, preserving its audit trail and references.

  // ─── Pin / Unpin ───────────────────────────────────────────────────
  // Curation action gated on `procurement.manage` (admins bypass), same as the
  // other procurement mutations. `requireProcurement(needManage=true)` also
  // fail-closes non-members and view-only members to 404.
  for (const pinned of [true, false] as const) {
    router.post(`/projects/:projectId/procurements/:id/${pinned ? "pin" : "unpin"}`, async (c) => {
      const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"), true);
      const db = c.get("db");
      const item = await resolveProcurementItem(db, procurement.id);
      if (!item)
        throw new NotFoundError("Procurement", procurement.id);
      await setItemPinned(db, item.id, pinned);
      const updated = await getProcurementByShortId(db, procurement.id);
      if (!updated)
        throw new NotFoundError("Procurement", procurement.id);
      return c.json({ success: true, data: updated });
    });
  }

  // ─── Status change ─────────────────────────────────────────────────
  router.post("/projects/:projectId/procurements/:id/status", async (c) => {
    const { procurement } = await requireProcurement(c, c.req.param("projectId"), c.req.param("id"), true);
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
      // Visibility is enforced by the project membership + `procurement.view`
      // capability gate. Anyone who can view a procurement can read and post
      // comments on it; admins bypass; authors (and admins) delete their own.
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
      const isMember = await isProjectMember(db, projectId, user.id);
      const canRead = isAdmin || (isMember && await hasCapability(db, projectId, user.id, "procurement.view"));
      const canPost = isAdmin || (isMember && await hasCapability(db, projectId, user.id, "procurement.comment"));
      return {
        canRead,
        canPost,
        includeInternal: canRead,
        canDelete: authorId => isAdmin || authorId === user.id,
      };
    },
  });

  return router;
}
