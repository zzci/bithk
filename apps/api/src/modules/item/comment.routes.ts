import type { Context, Hono } from "hono";
import type { AppDatabase } from "@/db";
import type { ItemRow } from "@/modules/item/item.service";
import type { ProtectedEnv } from "@/shared/lib/types";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import {
  buildDownloadResponse,
  getFileById,
  getReferenceById,
  listAttachmentsByOwner,
  makeAttachmentView,
  releaseReference,
  uploadAndReference,
} from "@/modules/file";
import { createComment, deleteComment, getCommentById, listComments } from "@/modules/item/comment.service";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { requireParam } from "@/shared/lib/route-params";

const DEFAULT_COMMENT_MAX_LENGTH = 2000;

function buildCommentSchema(maxLength: number) {
  return z.object({
    content: z.string().max(maxLength).default(""),
    hasAttachments: z.boolean().optional().default(false),
    replyToId: z.string().nullish(),
  });
}

// Multipart upload (`file` field) request-body doc for attachment uploads.
const fileUploadBody = { content: { "multipart/form-data": { schema: { type: "object" as const, properties: { file: { type: "string" as const, format: "binary" } } } } } };

// Mirrors `ItemCommentRow` (the `item_comments` row returned by the comment
// service).
const commentViewSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  authorId: z.string(),
  replyToId: z.string().nullable(),
  content: z.string(),
  isInternal: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
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

/**
 * Per-request permission read for one sub-type subject. Sub-types compute
 * these from their own access rules (creator/assignee, viewer/editor via
 * policy, commentsLocked, …) and hand the result back to the factory.
 *
 * `canDelete` is a function so the factory can pass the comment's author
 * id in (most sub-types allow "author or admin").
 */
export interface CommentPermissions {
  /** Can the actor list comments / list and download attachments? */
  readonly canRead: boolean;
  /** Can the actor post comments on this subject? `false` covers e.g. `commentsLocked`. */
  readonly canPost: boolean;
  /** Whether the listed comments include internal ones (admin / owner / assignee / approver typically true; viewers false). */
  readonly includeInternal: boolean;
  /** Can the actor delete this particular comment? */
  readonly canDelete: (commentAuthorId: string) => boolean;
}

export interface CommentSubject<TResource = unknown> {
  readonly item: ItemRow;
  /** Sub-type row data (e.g. the issue / document row). Opaque to the factory; consumed by `permissions`. */
  readonly resource: TResource;
  /** Used for `audit.resourceName`. */
  readonly resourceName: string;
  /** The sub-type's short id (the value the route param resolved to). */
  readonly externalId: string;
}

export interface MountItemCommentRoutesOptions<TResource = unknown> {
  /** URL prefix the sub-type mounts comments under, e.g. `/issues`, `/documents`. */
  readonly routePrefix: string;
  /** Audit resource type, e.g. `"issue"`, `"document"`. */
  readonly resourceType: string;
  /** Maximum comment body length in characters. Defaults to 2000. */
  readonly maxCommentLength?: number;
  /**
   * Resolve a route's `:id` to the parent subject. Return `null` when the
   * subject does not exist; the factory turns that into a `NotFoundError`.
   */
  readonly resolve: (db: AppDatabase, idParam: string) => Promise<CommentSubject<TResource> | null>;
  /** Compute the actor's permission read for this subject. */
  readonly permissions: (
    db: AppDatabase,
    user: { id: string; role: string },
    subject: CommentSubject<TResource>,
  ) => Promise<CommentPermissions>;
}

/**
 * Mount the shared comment + comment-attachment route set onto a sub-type's
 * router. Owned by `mod-item` because comments hang off `items.id` and the
 * permission story (parent_item / viewer / editor) is uniform across
 * sub-types. The sub-type only wires `resolve` + `permissions`.
 */
export function mountItemCommentRoutes<TResource>(
  router: Hono<ProtectedEnv>,
  opts: MountItemCommentRoutesOptions<TResource>,
): void {
  const { routePrefix: prefix, resourceType } = opts;
  const commentSchema = buildCommentSchema(opts.maxCommentLength ?? DEFAULT_COMMENT_MAX_LENGTH);

  // The path params contributed by the (dynamic) prefix, e.g. `projectId` for
  // `/projects/:projectId/issues`. Merged with each route's own params so the
  // generated spec documents every `:param` in the full path.
  const prefixParams = prefix.split("/").filter(s => s.startsWith(":")).map(s => s.slice(1));
  function paramSchema(...own: string[]) {
    const shape: Record<string, z.ZodString> = {};
    for (const key of [...prefixParams, ...own])
      shape[key] = z.string();
    return z.object(shape);
  }

  async function load(
    c: Context<ProtectedEnv>,
  ): Promise<{ db: AppDatabase; user: { id: string; role: string; name: string }; subject: CommentSubject<TResource>; perms: CommentPermissions }> {
    const db = c.get("db");
    const user = c.get("user");
    const subject = await opts.resolve(db, requireParam(c, "id"));
    if (!subject)
      throw new NotFoundError(resourceType, requireParam(c, "id"));
    const perms = await opts.permissions(db, user, subject);
    // Fail closed: an actor who cannot read the subject must not be able to
    // tell "exists but forbidden" apart from "does not exist". Mirror the
    // parent routes' 404 instead of leaking existence with a 403. Action-
    // level denials for readers (locked posting, non-author delete) stay 403.
    if (!perms.canRead)
      throw new NotFoundError(resourceType, subject.externalId);
    return { db, user, subject, perms };
  }

  router.get(
    `${prefix}/:id/comments`,
    describeRoute({
      tags: ["comments"],
      summary: `List ${resourceType} comments`,
      responses: {
        200: okJson(z.array(commentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    async (c) => {
      const { db, subject, perms } = await load(c);
      const data = await listComments(db, subject.item.id, { includeInternal: perms.includeInternal });
      return c.json({ success: true, data });
    },
  );

  router.post(
    `${prefix}/:id/comments`,
    describeRoute({
      tags: ["comments"],
      summary: `Post a ${resourceType} comment`,
      responses: {
        201: okJson(commentViewSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    validator("json", commentSchema, onValidationFailure),
    async (c) => {
      const { db, user, subject, perms } = await load(c);
      if (!perms.canPost)
        throw new ForbiddenError();
      const body = c.req.valid("json");
      if (body.content.trim().length === 0 && !body.hasAttachments)
        throw new ValidationError("Comment requires content or an attachment", { content: "Comment cannot be empty" });
      const comment = await createComment(db, {
        itemId: subject.item.id,
        authorId: user.id,
        content: body.content,
        replyToId: body.replyToId ?? null,
      });
      await auditFromCtx(c, {
        action: `${resourceType}.comment_added`,
        resourceType,
        resourceId: subject.externalId,
        resourceName: subject.resourceName,
        detail: { commentId: comment.id },
        result: "success",
      });
      return c.json({ success: true, data: comment }, 201);
    },
  );

  router.delete(
    `${prefix}/:id/comments/:cid`,
    describeRoute({
      tags: ["comments"],
      summary: `Delete a ${resourceType} comment`,
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "cid"), onValidationFailure),
    async (c) => {
      const { db, subject, perms } = await load(c);
      const cid = requireParam(c, "cid");
      const comment = await getCommentById(db, subject.item.id, cid);
      if (!comment)
        throw new NotFoundError("Comment", cid);
      if (!perms.canDelete(comment.authorId))
        throw new ForbiddenError();
      await deleteComment(db, cid);
      await auditFromCtx(c, {
        action: `${resourceType}.comment_deleted`,
        resourceType,
        resourceId: subject.externalId,
        resourceName: subject.resourceName,
        detail: { commentId: cid },
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // ── Comment attachments (owner_type='item_comment_attachment') ──

  router.get(
    `${prefix}/:id/comments/:cid/attachments`,
    describeRoute({
      tags: ["comments"],
      summary: `List ${resourceType} comment attachments`,
      responses: {
        200: okJson(z.array(attachmentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "cid"), onValidationFailure),
    async (c) => {
      const { db, subject } = await load(c);
      const cid = requireParam(c, "cid");
      const comment = await getCommentById(db, subject.item.id, cid);
      if (!comment)
        throw new NotFoundError("Comment", cid);
      const data = await listAttachmentsByOwner(db, "item_comment_attachment", cid);
      return c.json({ success: true, data });
    },
  );

  router.post(
    `${prefix}/:id/comments/:cid/attachments`,
    describeRoute({
      tags: ["comments"],
      summary: `Upload a ${resourceType} comment attachment`,
      requestBody: fileUploadBody,
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "cid"), onValidationFailure),
    async (c) => {
      const { db, user, subject } = await load(c);
      const cid = requireParam(c, "cid");
      const comment = await getCommentById(db, subject.item.id, cid);
      if (!comment)
        throw new NotFoundError("Comment", cid);
      // Only the comment author can attach files to their own comment. This
      // rule is uniform across sub-types — admins also do not bypass it,
      // because the attachment is part of the author's speech.
      if (comment.authorId !== user.id)
        throw new ForbiddenError();

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
        ownerType: "item_comment_attachment",
        ownerId: cid,
        uploadedBy: user.id,
      });
      const view = makeAttachmentView(reference, uploaded);

      await auditFromCtx(c, {
        action: `${resourceType}.comment_attachment_uploaded`,
        resourceType,
        resourceId: subject.externalId,
        resourceName: subject.resourceName,
        detail: { commentId: cid, attachmentId: reference.id, filename: file.name, size: file.size },
        result: "success",
      });
      return c.json({ success: true, data: view }, 201);
    },
  );

  router.get(
    `${prefix}/:id/comments/:cid/attachments/:aid`,
    describeRoute({
      tags: ["comments"],
      summary: `Download a ${resourceType} comment attachment`,
      responses: {
        200: { description: "Attachment file stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "cid", "aid"), onValidationFailure),
    async (c) => {
      const { db, subject } = await load(c);
      const cid = requireParam(c, "cid");
      const aid = requireParam(c, "aid");
      const comment = await getCommentById(db, subject.item.id, cid);
      if (!comment)
        throw new NotFoundError("Comment", cid);
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== "item_comment_attachment" || ref.ownerId !== cid)
        throw new NotFoundError("Attachment", aid);
      const fileRow = await getFileById(db, ref.fileId);
      if (!fileRow)
        throw new NotFoundError("File", aid);
      const wantInline = c.req.query("inline") === "true";
      return await buildDownloadResponse(c.get("config"), fileRow, ref, { inline: wantInline });
    },
  );

  router.delete(
    `${prefix}/:id/comments/:cid/attachments/:aid`,
    describeRoute({
      tags: ["comments"],
      summary: `Delete a ${resourceType} comment attachment`,
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "cid", "aid"), onValidationFailure),
    async (c) => {
      const { db, user, subject } = await load(c);
      const cid = requireParam(c, "cid");
      const aid = requireParam(c, "aid");
      const comment = await getCommentById(db, subject.item.id, cid);
      if (!comment)
        throw new NotFoundError("Comment", cid);
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== "item_comment_attachment" || ref.ownerId !== cid)
        throw new NotFoundError("Attachment", aid);
      if (user.role !== "admin" && ref.createdBy !== user.id)
        throw new ForbiddenError();
      await releaseReference(db, c.get("config"), { referenceId: aid });
      await auditFromCtx(c, {
        action: `${resourceType}.comment_attachment_deleted`,
        resourceType,
        resourceId: subject.externalId,
        resourceName: subject.resourceName,
        detail: { commentId: cid, attachmentId: aid, filename: ref.filename },
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );
}
