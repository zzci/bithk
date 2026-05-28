import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import {
  buildDownloadResponse,
  getFileById,
  getReferenceById,
  listAttachmentsByOwner,
  makeAttachmentView,
  releaseReference,
  uploadAndReference,
} from "@/modules/file";
import { mountItemCommentRoutes } from "@/modules/item/comment.routes";
import { setItemPinned } from "@/modules/item/item.service";
import { isMember as isProjectMember, resolveProjectId } from "@/modules/project/project.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import {
  createIssue,
  getIssueByShortId,
  listByProject,
  resolveIssueItem,
  resolveIssueProjectId,
  resolveProjectIssueAccess,
  softDeleteIssue,
  updateIssue,
} from "./issue.service";
import { mountIssueReferenceRoutes, referenceInputSchema } from "./references.routes";

// Project work order: the assignment target is a `project_members.id`. The
// project comes from the `:projectId` path param.
const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeMemberId: z.string().min(1).optional(),
  dueDate: z.string().max(30).optional(),
  // Optional generic references inserted alongside the issue (additive).
  references: z.array(referenceInputSchema).max(50).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
  dueDate: z.string().max(30).nullable().optional(),
}).refine(d => Object.values(d).some(v => v !== undefined), {
  message: "At least one field must be provided",
});

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

/**
 * Resolve a project's internal id from its short id and assert the actor is a
 * member. Fail-closed: a missing project and a non-member both surface as 404
 * so project membership and project-issue existence are never leaked.
 */
async function requireProjectMember(c: Context<AppEnv>, shortId: string): Promise<string> {
  const db = c.get("db");
  const user = c.get("user")!;
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  // App admins bypass project membership entirely (view/manage every project).
  if (user.role === "admin")
    return projectId;
  if (!await isProjectMember(db, projectId, user.id))
    throw new NotFoundError("Project", shortId);
  return projectId;
}

/**
 * Resolve a project issue within its project scope. Asserts membership on the
 * path project and that the issue actually belongs to it; both failures are a
 * fail-closed 404. Returns the resolved internal project id, the `items` row,
 * and the actor's access flags.
 */
async function loadProjectIssue(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const projectShort = c.req.param("projectId")!;
  const issueShort = c.req.param("id")!;
  const projectId = await requireProjectMember(c, projectShort);

  const item = await resolveIssueItem(db, issueShort);
  if (!item)
    throw new NotFoundError("Issue", issueShort);
  const ownerProject = await resolveIssueProjectId(db, issueShort);
  if (ownerProject !== projectId)
    throw new NotFoundError("Issue", issueShort);

  const access = await resolveProjectIssueAccess(db, item, projectId, user.id);
  const isAdmin = user.role === "admin";
  return { db, user, projectId, projectShort, issueShort, item, access, isAdmin };
}

export function issueRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // ─── List ──────────────────────────────────────────────────────────
  // Member-gated; non-members get a fail-closed 404.
  router.get("/projects/:projectId/issues", async (c) => {
    const projectId = await requireProjectMember(c, c.req.param("projectId"));
    const db = c.get("db");
    const q = c.req.query("q");
    const status = c.req.query("status");
    const priority = c.req.query("priority");
    const page = Math.max(1, Math.floor(Number.parseInt(c.req.query("page") ?? "", 10)) || 1);
    const limit = Math.min(100, Math.max(1, Math.floor(Number.parseInt(c.req.query("limit") ?? "", 10)) || 20));

    const result = await listByProject(db, { projectId, q, status, priority, page, limit });
    return c.json({
      success: true,
      data: result.data,
      meta: { total: result.total, page, limit },
    });
  });

  // ─── Create ────────────────────────────────────────────────────────
  // Member-gated; the assignee (if any) must be a member of this project —
  // `createIssue` validates it via the project module.
  router.post("/projects/:projectId/issues", async (c) => {
    const shortId = c.req.param("projectId");
    const projectId = await requireProjectMember(c, shortId);
    const db = c.get("db");
    const actor = c.get("user")!;
    const body = createSchema.parse(await c.req.json());

    const issue = await createIssue(db, {
      ...body,
      projectId,
      creatorId: actor.id,
    });

    await audit(db, c.get("logger"), {
      actorId: actor.id,
      actorName: actor.name,
      action: "issue.created",
      resourceType: "issue",
      resourceId: issue.id,
      resourceName: issue.title,
      detail: { projectId: shortId, ...(body.assigneeMemberId ? { assigneeMemberId: body.assigneeMemberId } : {}) },
      ...auditMeta(c),
      result: "success",
    });

    return c.json({ success: true, data: issue }, 201);
  });

  // ─── Detail ────────────────────────────────────────────────────────
  router.get("/projects/:projectId/issues/:id", async (c) => {
    const { db, issueShort } = await loadProjectIssue(c);
    const issue = await getIssueByShortId(db, issueShort);
    if (!issue)
      throw new NotFoundError("Issue", issueShort);
    return c.json({ success: true, data: issue });
  });

  // ─── Update ────────────────────────────────────────────────────────
  router.patch("/projects/:projectId/issues/:id", async (c) => {
    const { db, user, issueShort, access, isAdmin } = await loadProjectIssue(c);
    const existing = await getIssueByShortId(db, issueShort);
    if (!existing)
      throw new NotFoundError("Issue", issueShort);

    const canEditAll = isAdmin || access.canEdit;
    if (!canEditAll && !access.isAssignee)
      throw new ForbiddenError();

    const body = updateSchema.parse(await c.req.json());

    // Assignees (who are not pm / creator) may only change status.
    if (!canEditAll) {
      const nonStatusKeys = Object.keys(body).filter(k => k !== "status");
      if (nonStatusKeys.length > 0)
        throw new AppError("Assignees can only update status", 403, "FORBIDDEN");
    }

    const updated = await updateIssue(db, issueShort, body);

    const detail: Record<string, unknown> = {};
    if (body.status && body.status !== existing.status) {
      detail.previousStatus = existing.status;
      detail.newStatus = body.status;
    }

    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "issue.updated",
      resourceType: "issue",
      resourceId: issueShort,
      resourceName: existing.title,
      ...(Object.keys(detail).length > 0 ? { detail } : {}),
      ...auditMeta(c),
      result: "success",
    });

    if (body.status && body.status !== existing.status) {
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "issue.status_changed",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: existing.title,
        detail: { previous: existing.status, new: body.status },
        ...auditMeta(c),
        result: "success",
      });
    }

    if (body.assigneeMemberId !== undefined && body.assigneeMemberId !== existing.assigneeMemberId) {
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "issue.assigned",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: existing.title,
        detail: { from: existing.assigneeMemberId, to: body.assigneeMemberId },
        ...auditMeta(c),
        result: "success",
      });
    }

    return c.json({ success: true, data: updated });
  });

  // ─── Pin / Unpin ───────────────────────────────────────────────────
  // Pinning is a manage-level curation action: an app admin or a member who
  // can edit the issue (pm via `issue.manage`, or the creator) may pin/unpin.
  // A status-only assignee cannot. Mirrors the edit gate in the PATCH route.
  for (const pinned of [true, false] as const) {
    router.post(`/projects/:projectId/issues/:id/${pinned ? "pin" : "unpin"}`, async (c) => {
      const { db, user, issueShort, item, access, isAdmin } = await loadProjectIssue(c);
      if (!isAdmin && !access.canEdit)
        throw new ForbiddenError();
      await setItemPinned(db, item.id, pinned);
      const updated = await getIssueByShortId(db, issueShort);
      if (!updated)
        throw new NotFoundError("Issue", issueShort);
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: pinned ? "issue.pinned" : "issue.unpinned",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: updated.title,
        ...auditMeta(c),
        result: "success",
      });
      return c.json({ success: true, data: updated });
    });
  }

  // ─── Delete (soft) ─────────────────────────────────────────────────
  router.delete("/projects/:projectId/issues/:id", async (c) => {
    const { db, user, issueShort, access, isAdmin } = await loadProjectIssue(c);
    const existing = await getIssueByShortId(db, issueShort);
    if (!existing)
      throw new NotFoundError("Issue", issueShort);
    if (!isAdmin && !access.canEdit)
      throw new ForbiddenError();
    await softDeleteIssue(db, issueShort);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "issue.deleted",
      resourceType: "issue",
      resourceId: issueShort,
      resourceName: existing.title,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  // ─── Attachments (delegating to mod-file) ─────────────────────────
  router.post("/projects/:projectId/issues/:id/attachments", async (c) => {
    const { db, user, issueShort, item, access, isAdmin } = await loadProjectIssue(c);
    if (!isAdmin && !access.canEdit && !access.isAssignee)
      throw new ForbiddenError();
    const issue = await getIssueByShortId(db, issueShort);
    if (!issue)
      throw new NotFoundError("Issue", issueShort);

    const config = c.get("config");
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > config.MAX_UPLOAD_BYTES)
      throw new AppError("Upload too large", 413, "UPLOAD_TOO_LARGE");

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new AppError("No file provided", 400, "VALIDATION_ERROR");

    const { reference, file: uploaded } = await uploadAndReference(db, config, {
      file,
      ownerType: "item_attachment",
      ownerId: item.id,
      uploadedBy: user.id,
    });
    const view = makeAttachmentView(reference, uploaded);

    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "issue.attachment_uploaded",
      resourceType: "issue",
      resourceId: issueShort,
      resourceName: issue.title,
      detail: { attachmentId: reference.id, filename: file.name, size: file.size },
      ...auditMeta(c),
      result: "success",
    });

    return c.json({ success: true, data: view }, 201);
  });

  router.get("/projects/:projectId/issues/:id/attachments", async (c) => {
    const { db, item } = await loadProjectIssue(c);
    const data = await listAttachmentsByOwner(db, "item_attachment", item.id);
    return c.json({ success: true, data });
  });

  router.get("/projects/:projectId/issues/:id/attachments/:aid", async (c) => {
    const { db, item } = await loadProjectIssue(c);
    const aid = c.req.param("aid");
    const ref = await getReferenceById(db, aid);
    if (!ref || ref.ownerType !== "item_attachment" || ref.ownerId !== item.id)
      throw new NotFoundError("Attachment", aid);
    const file = await getFileById(db, ref.fileId);
    if (!file)
      throw new NotFoundError("File", aid);
    const wantInline = c.req.query("inline") === "true";
    return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
  });

  router.delete("/projects/:projectId/issues/:id/attachments/:aid", async (c) => {
    const { db, user, item, access, isAdmin } = await loadProjectIssue(c);
    const aid = c.req.param("aid");
    const ref = await getReferenceById(db, aid);
    if (!ref || ref.ownerType !== "item_attachment" || ref.ownerId !== item.id)
      throw new NotFoundError("Attachment", aid);
    if (!isAdmin && !access.canEdit && ref.createdBy !== user.id)
      throw new ForbiddenError();
    await releaseReference(db, c.get("config"), { referenceId: aid });
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "issue.attachment_deleted",
      resourceType: "issue",
      resourceId: c.req.param("id"),
      resourceName: item.title,
      detail: { attachmentId: aid, filename: ref.filename },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  // ─── Comments + attachments (delegated to mod-item) ───────────────
  mountItemCommentRoutes(router, {
    routePrefix: "/projects/:projectId/issues",
    resourceType: "issue",
    async resolve(db, idParam) {
      const issue = await getIssueByShortId(db, idParam);
      if (!issue)
        return null;
      const item = await resolveIssueItem(db, idParam);
      if (!item)
        return null;
      const projectId = await resolveIssueProjectId(db, idParam);
      if (!projectId)
        return null;
      return { item, resource: { projectId }, externalId: idParam, resourceName: issue.title };
    },
    async permissions(db, user, subject) {
      // Access is derived from the issue's real project membership; the path
      // `:projectId` is structural only.
      const { projectId } = subject.resource as { projectId: string };
      const access = await resolveProjectIssueAccess(db, subject.item, projectId, user.id);
      const isAdmin = user.role === "admin";
      const canRead = isAdmin || access.canRead;
      return {
        canRead,
        canPost: canRead,
        includeInternal: canRead,
        canDelete: authorId => isAdmin || authorId === user.id,
      };
    },
  });

  // ─── Generic references + maintenance work orders (additive) ───────
  mountIssueReferenceRoutes(router);

  return router;
}
