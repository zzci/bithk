import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
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
import { getMemberCapabilities, resolveProjectId } from "@/modules/project/project.service";
import { listReferenceableWorklists } from "@/modules/ship/ship.worklist.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { parsePageQuery } from "@/shared/lib/pagination";
import { requireParam } from "@/shared/lib/route-params";
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
const ISSUE_STATUSES = ["todo", "working", "review", "done", "cancel"] as const;
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

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
// Paginated `{ success:true, data:[…], meta }` response doc.
const pageMetaSchema = z.object({ total: z.number(), page: z.number(), limit: z.number() });
function okListJson(itemSchema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: z.array(itemSchema), meta: pageMetaSchema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };
// Multipart upload (`file` field) request-body doc for attachment uploads.
const fileUploadBody = { content: { "multipart/form-data": { schema: { type: "object" as const, properties: { file: { type: "string" as const, format: "binary" } } } } } };

const projectIdParam = z.object({ projectId: z.string() });
const issueParam = z.object({ projectId: z.string(), id: z.string() });
const attachmentParam = z.object({ projectId: z.string(), id: z.string(), aid: z.string() });
const inlineQuery = z.object({ inline: z.string().optional() });

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

// Mirrors `AttachmentView` from the file module.
const attachmentViewSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  ownerType: z.string(),
  ownerId: z.string(),
  filename: z.string(),
  mimetype: z.string(),
  size: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
});

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

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

      // Mirror access: a create that sets an assignee also emits issue.assigned.
      if (body.assigneeMemberId) {
        await audit(db, c.get("logger"), {
          actorId: actor.id,
          actorName: actor.name,
          action: "issue.assigned",
          resourceType: "issue",
          resourceId: issue.id,
          resourceName: issue.title,
          detail: { from: null, to: body.assigneeMemberId },
          ...auditMeta(c),
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
      const { db, user, issueShort, access, isAdmin } = await loadProjectIssue(c);
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
    },
  );

  // ─── Attachments (delegating to mod-file) ─────────────────────────
  router.post(
    "/projects/:projectId/issues/:id/attachments",
    describeRoute({
      tags: ["issues"],
      summary: "Upload an issue attachment",
      requestBody: fileUploadBody,
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
      },
    }),
    validator("param", issueParam, onValidationFailure),
    async (c) => {
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
    },
  );

  router.get(
    "/projects/:projectId/issues/:id/attachments",
    describeRoute({
      tags: ["issues"],
      summary: "List issue attachments",
      responses: {
        200: okJson(z.array(attachmentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
      },
    }),
    validator("param", issueParam, onValidationFailure),
    async (c) => {
      const { db, item } = await loadProjectIssue(c);
      const data = await listAttachmentsByOwner(db, "item_attachment", item.id);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/projects/:projectId/issues/:id/attachments/:aid",
    describeRoute({
      tags: ["issues"],
      summary: "Download an issue attachment",
      responses: {
        200: { description: "Attachment file stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Attachment not found", ...errorJson },
      },
    }),
    validator("param", attachmentParam, onValidationFailure),
    validator("query", inlineQuery, onValidationFailure),
    async (c) => {
      const { db, item } = await loadProjectIssue(c);
      const { aid } = c.req.valid("param");
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== "item_attachment" || ref.ownerId !== item.id)
        throw new NotFoundError("Attachment", aid);
      const file = await getFileById(db, ref.fileId);
      if (!file)
        throw new NotFoundError("File", aid);
      const wantInline = c.req.query("inline") === "true";
      return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
    },
  );

  router.delete(
    "/projects/:projectId/issues/:id/attachments/:aid",
    describeRoute({
      tags: ["issues"],
      summary: "Delete an issue attachment",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Attachment not found", ...errorJson },
      },
    }),
    validator("param", attachmentParam, onValidationFailure),
    async (c) => {
      const { db, user, issueShort, item, access, isAdmin } = await loadProjectIssue(c);
      const { aid } = c.req.valid("param");
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
        resourceId: issueShort,
        resourceName: item.title,
        detail: { attachmentId: aid, filename: ref.filename },
        ...auditMeta(c),
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

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
