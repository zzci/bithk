import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { mountItemAttachmentRoutes } from "@/modules/item/attachment.routes";
import { mountItemCommentRoutes } from "@/modules/item/comment.routes";
import { setItemPinned } from "@/modules/item/item.service";
import { getMemberCapabilities, resolveProjectId } from "@/modules/project/project.service";
import { listReferenceableWorklists } from "@/modules/ship/ship.worklist.service";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { parsePageQuery } from "@/shared/lib/pagination";
import { parseTagIds, requireParam } from "@/shared/lib/route-params";
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
import { ISSUE_STATUSES } from "./schema";

// Project work order: the assignment target is a `project_members.id`. The
// project comes from the `:projectId` path param.
const ISSUE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assigneeMemberId: z.string().min(1).optional(),
  dueDate: z.string().max(30).optional(),
  // Optional tag names (tag type 'issue') synced with the issue.
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  // Optional generic references inserted alongside the issue (additive).
  references: z.array(referenceInputSchema).max(50).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
  dueDate: z.string().max(30).nullable().optional(),
  // Replacement tag set (tag type 'issue'); omit to leave tags unchanged.
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
}).refine(d => Object.values(d).some(v => v !== undefined), {
  message: "At least one field must be provided",
});

// Treat an empty query value (`?status=`) as absent, preserving the previous
// `c.req.query("x") || undefined` normalization before the schema validates.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

// Bounded list-query schema for the list edge: caps `q` length and validates
// status / priority against their enums (invalid → 422 instead of silently
// yielding zero rows). Pagination uses `parsePageQuery`.
const listQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(ISSUE_STATUSES).optional()),
  priority: z.preprocess(emptyToUndefined, z.enum(ISSUE_PRIORITIES).optional()),
});

const projectIdParam = z.object({ projectId: z.string() });
const issueParam = z.object({ projectId: z.string(), id: z.string() });

// Mirrors `IssueRow` returned by the issue service.
const tagRefSchema = z.object({ id: z.string(), name: z.string() });
const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.enum(ISSUE_PRIORITIES),
  creatorId: z.string(),
  assigneeId: z.string().nullable(),
  dueDate: z.string().nullable(),
  projectId: z.string(),
  assigneeMemberId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  pinned: z.boolean(),
  pinnedAt: z.string().nullable(),
  tags: z.array(tagRefSchema),
});

// Mirrors `WorklistView` and the `listReferenceableWorklists` result.
const worklistViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(tagRefSchema),
  checklist: z.string().nullable(),
  precautions: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const referenceableWorklistsSchema = z.object({
  ship: z.array(worklistViewSchema),
  global: z.array(worklistViewSchema),
});

/**
 * Resolve a project's internal id from its short id and assert the actor is a
 * member with `issue.view`. Fail-closed: a missing project, a non-member, and
 * a member without `issue.view` all surface as 404 so project membership and
 * project-issue existence are never leaked.
 */
async function requireProjectMember(c: Context<ProtectedEnv>, shortId: string): Promise<string> {
  const db = c.get("db");
  const user = c.get("user");
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  // App admins bypass project membership entirely (view/manage every project).
  if (user.role === "admin")
    return projectId;
  const caps = await getMemberCapabilities(db, projectId, user.id);
  // Non-members (caps===null) or members without issue.view both get 404.
  if (!caps || !caps.has("issue.view"))
    throw new NotFoundError("Project", shortId);
  return projectId;
}

/**
 * Resolve a project issue within its project scope. Asserts membership on the
 * path project and that the issue actually belongs to it; both failures are a
 * fail-closed 404. Returns the resolved internal project id, the `items` row,
 * and the actor's access flags.
 */
async function loadProjectIssue(c: Context<ProtectedEnv>) {
  const db = c.get("db");
  const user = c.get("user");
  const projectShort = requireParam(c, "projectId");
  const issueShort = requireParam(c, "id");
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
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── List ──────────────────────────────────────────────────────────
  // Member-gated; non-members get a fail-closed 404.
  router.get(
    "/projects/:projectId/issues",
    describeRoute({
      tags: ["issues"],
      summary: "List a project's issues",
      responses: {
        200: okListJson(issueSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const projectId = await requireProjectMember(c, c.req.valid("param").projectId);
      const db = c.get("db");
      const { q, status, priority } = c.req.valid("query");
      const tagIds = parseTagIds(c.req.queries("tagIds"));
      const { page, limit } = parsePageQuery(c, { limit: 20 });

      const result = await listByProject(db, { projectId, q, status, priority, tagIds, page, limit });
      return c.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    },
  );

  // ─── Referenceable worklists ───────────────────────────────────────
  // The worklists this project may reference when creating a work order: its
  // ship's worklists (when it is a ship base project) plus the global KB.
  // Member-gated via requireProjectMember (issue.view); non-members get a
  // fail-closed 404.
  router.get(
    "/projects/:projectId/referenceable-worklists",
    describeRoute({
      tags: ["issues"],
      summary: "List worklists a project may reference",
      responses: {
        200: okJson(referenceableWorklistsSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", projectIdParam, onValidationFailure),
    async (c) => {
      const projectId = await requireProjectMember(c, c.req.valid("param").projectId);
      const db = c.get("db");
      return c.json({ success: true, data: await listReferenceableWorklists(db, projectId) });
    },
  );

  // ─── Create ────────────────────────────────────────────────────────
  // Requires issue.view (via requireProjectMember) + issue.manage.
  // A viewer who lacks issue.manage gets 403; a non-viewer/non-member gets 404.
  router.post(
    "/projects/:projectId/issues",
    describeRoute({
      tags: ["issues"],
      summary: "Create a work order (issue)",
      responses: {
        201: okJson(issueSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("json", createSchema, onValidationFailure),
    async (c) => {
      const shortId = c.req.valid("param").projectId;
      const projectId = await requireProjectMember(c, shortId);
      const db = c.get("db");
      const actor = c.get("user");
      // App admins bypass capability checks.
      if (actor.role !== "admin") {
        const caps = await getMemberCapabilities(db, projectId, actor.id);
        if (!caps?.has("issue.manage"))
          throw new ForbiddenError();
      }
      const body = c.req.valid("json");

      const issue = await createIssue(db, {
        ...body,
        projectId,
        creatorId: actor.id,
      });

      await auditFromCtx(c, {
        action: "issue.created",
        resourceType: "issue",
        resourceId: issue.id,
        resourceName: issue.title,
        detail: { projectId: shortId, ...(body.assigneeMemberId ? { assigneeMemberId: body.assigneeMemberId } : {}) },
        result: "success",
      });

      // Mirror access: a create that sets an assignee also emits issue.assigned.
      if (body.assigneeMemberId) {
        await auditFromCtx(c, {
          action: "issue.assigned",
          resourceType: "issue",
          resourceId: issue.id,
          resourceName: issue.title,
          detail: { from: null, to: body.assigneeMemberId },
          result: "success",
        });
      }

      return c.json({ success: true, data: issue }, 201);
    },
  );

  // ─── Detail ────────────────────────────────────────────────────────
  router.get(
    "/projects/:projectId/issues/:id",
    describeRoute({
      tags: ["issues"],
      summary: "Get a work order (issue)",
      responses: {
        200: okJson(issueSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
      },
    }),
    validator("param", issueParam, onValidationFailure),
    async (c) => {
      const { db, issueShort } = await loadProjectIssue(c);
      const issue = await getIssueByShortId(db, issueShort);
      if (!issue)
        throw new NotFoundError("Issue", issueShort);
      return c.json({ success: true, data: issue });
    },
  );

  // ─── Update ────────────────────────────────────────────────────────
  router.patch(
    "/projects/:projectId/issues/:id",
    describeRoute({
      tags: ["issues"],
      summary: "Update a work order (issue)",
      responses: {
        200: okJson(issueSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", issueParam, onValidationFailure),
    validator("json", updateSchema, onValidationFailure),
    async (c) => {
      const { db, issueShort, access, isAdmin } = await loadProjectIssue(c);
      const existing = await getIssueByShortId(db, issueShort);
      if (!existing)
        throw new NotFoundError("Issue", issueShort);

      const canEditAll = isAdmin || access.canEdit;
      if (!canEditAll && !access.isAssignee)
        throw new ForbiddenError();

      const body = c.req.valid("json");

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

      await auditFromCtx(c, {
        action: "issue.updated",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: existing.title,
        ...(Object.keys(detail).length > 0 ? { detail } : {}),
        result: "success",
      });

      if (body.status && body.status !== existing.status) {
        await auditFromCtx(c, {
          action: "issue.status_changed",
          resourceType: "issue",
          resourceId: issueShort,
          resourceName: existing.title,
          detail: { previous: existing.status, new: body.status },
          result: "success",
        });
      }

      if (body.assigneeMemberId !== undefined && body.assigneeMemberId !== existing.assigneeMemberId) {
        await auditFromCtx(c, {
          action: "issue.assigned",
          resourceType: "issue",
          resourceId: issueShort,
          resourceName: existing.title,
          detail: { from: existing.assigneeMemberId, to: body.assigneeMemberId },
          result: "success",
        });
      }

      return c.json({ success: true, data: updated });
    },
  );

  // ─── Pin / Unpin ───────────────────────────────────────────────────
  // Pinning is a manage-level curation action: an app admin or a member who
  // can edit the issue (pm via `issue.manage`, or the creator) may pin/unpin.
  // A status-only assignee cannot. Mirrors the edit gate in the PATCH route.
  for (const pinned of [true, false] as const) {
    router.post(
      `/projects/:projectId/issues/:id/${pinned ? "pin" : "unpin"}`,
      describeRoute({
        tags: ["issues"],
        summary: `${pinned ? "Pin" : "Unpin"} a work order (issue)`,
        responses: {
          200: okJson(issueSchema),
          401: { description: "Unauthenticated", ...errorJson },
          403: { description: "Forbidden", ...errorJson },
          404: { description: "Issue not found", ...errorJson },
        },
      }),
      validator("param", issueParam, onValidationFailure),
      async (c) => {
        const { db, issueShort, item, access, isAdmin } = await loadProjectIssue(c);
        if (!isAdmin && !access.canEdit)
          throw new ForbiddenError();
        await setItemPinned(db, item.id, pinned);
        const updated = await getIssueByShortId(db, issueShort);
        if (!updated)
          throw new NotFoundError("Issue", issueShort);
        await auditFromCtx(c, {
          action: pinned ? "issue.pinned" : "issue.unpinned",
          resourceType: "issue",
          resourceId: issueShort,
          resourceName: updated.title,
          result: "success",
        });
        return c.json({ success: true, data: updated });
      },
    );
  }

  // ─── Delete (soft) ─────────────────────────────────────────────────
  router.delete(
    "/projects/:projectId/issues/:id",
    describeRoute({
      tags: ["issues"],
      summary: "Delete a work order (issue)",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
      },
    }),
    validator("param", issueParam, onValidationFailure),
    async (c) => {
      const { db, issueShort, access, isAdmin } = await loadProjectIssue(c);
      const existing = await getIssueByShortId(db, issueShort);
      if (!existing)
        throw new NotFoundError("Issue", issueShort);
      if (!isAdmin && !access.canEdit)
        throw new ForbiddenError();
      await softDeleteIssue(db, issueShort);
      await auditFromCtx(c, {
        action: "issue.deleted",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: existing.title,
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // ─── Attachments (delegated to mod-item) ──────────────────────────
  mountItemAttachmentRoutes(router, {
    routePrefix: "/projects/:projectId/issues",
    resourceType: "issue",
    tag: "issues",
    summaries: {
      upload: "Upload an issue attachment",
      fromDrive: "Attach a drive file to an issue",
      list: "List issue attachments",
      download: "Download an issue attachment",
      delete: "Delete an issue attachment",
    },
    async resolve(db, idParam, params) {
      const item = await resolveIssueItem(db, idParam);
      if (!item)
        return null;
      const issue = await getIssueByShortId(db, idParam);
      if (!issue)
        return null;
      // The path project must actually own the issue; a mismatch is the same
      // fail-closed 404 the parent routes produce (mirrors loadProjectIssue).
      const pathProject = params.projectId ? await resolveProjectId(db, params.projectId) : null;
      const ownerProject = await resolveIssueProjectId(db, idParam);
      if (!ownerProject || ownerProject !== pathProject)
        return null;
      return { ownerId: item.id, resource: { item, projectId: ownerProject }, externalId: idParam, resourceName: issue.title };
    },
    async permissions(db, user, subject) {
      const { item, projectId } = subject.resource;
      const access = await resolveProjectIssueAccess(db, item, projectId, user.id);
      const isAdmin = user.role === "admin";
      return {
        // Membership + issue.view, exactly the requireProjectMember gate.
        canRead: isAdmin || access.canRead,
        canWrite: isAdmin || access.canEdit || access.isAssignee,
        canDelete: createdBy => isAdmin || access.canEdit || createdBy === user.id,
      };
    },
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
      // canPost requires issue.comment (decoupled from canRead).
      const canPost = isAdmin || access.canComment;
      return {
        canRead,
        canPost,
        includeInternal: canRead,
        canDelete: authorId => isAdmin || authorId === user.id,
      };
    },
  });

  // ─── Generic issue references (additive) ───────
  mountIssueReferenceRoutes(router);

  return router;
}
