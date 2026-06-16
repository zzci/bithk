import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { listActiveUsers } from "@/modules/account/users/users.service";
import { audit } from "@/modules/audit/audit.service";
import {
  buildDownloadResponse,
  getFileById,
  getReferenceById,
  listAttachmentsByOwner,
  makeAttachmentView,
  releaseAllByOwner,
  releaseReference,
  uploadAndReference,
} from "@/modules/file";
import { mountItemCommentRoutes } from "@/modules/item/comment.routes";
import { NOOP_POLICY_LOGGER, policyContext } from "@/modules/policy";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { documentAccess } from "./document.permission";
import {
  addDocumentShare,
  createDocument,
  getDocumentById,
  getDocumentShareById,
  getDocumentTreeForUser,
  isVersionConflict,
  listAllGroups,
  listAllTags,
  listDescendantIds,
  listDocumentSharesWithInheritance,
  listMyDocuments,
  pinDocument,
  removeDocumentShare,
  resolveDocumentItem,
  softDeleteDocument,
  unpinDocument,
  updateDocument,
} from "./document.service";

const tagSchema = z.string().min(1).max(50).regex(/^[\w-]+$/);

const createSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(50000).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  parentId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().max(50000).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  parentId: z.string().nullable().optional(),
  commentsLocked: z.boolean().optional(),
  version: z.number().int().nonnegative(),
}).refine(d => Object.entries(d).some(([k, v]) => k !== "version" && v !== undefined), {
  message: "At least one mutable field must be provided",
});

const moveSchema = z.object({
  parentId: z.string().nullable(),
});

const shareSchema = z.object({
  targetType: z.enum(["user", "group"]),
  targetId: z.string().min(1),
  permission: z.enum(["viewer", "editor"]).default("viewer"),
});

// Path-param + query schemas — declared so the parameters surface in the
// generated OpenAPI spec and the handler reads typed `string` values via
// `c.req.valid("param")` instead of `string | undefined`.
const idParam = z.object({ id: z.string() });
const attachmentParam = z.object({ id: z.string(), aid: z.string() });
const shareParam = z.object({ id: z.string(), shareId: z.string() });
const listQuery = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});
const inlineQuery = z.object({ inline: z.string().optional() });

// Response `data` schemas mirroring the real composed shapes.
const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  tags: z.string(),
  parentId: z.string().nullable(),
  version: z.number(),
  commentsLocked: z.boolean(),
  creatorId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const documentTreeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  updatedAt: z.string(),
  childCount: z.number(),
  pinned: z.boolean(),
});
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
const userPickerSchema = z.object({ id: z.string(), name: z.string(), username: z.string() });
const groupSchema = z.object({ id: z.string(), name: z.string() });
const shareWithSourceSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  targetType: z.enum(["user", "group"]),
  targetId: z.string(),
  permission: z.enum(["viewer", "editor"]),
  createdAt: z.string(),
  inheritedFrom: z.object({ id: z.string(), title: z.string() }).nullable(),
});
const shareResponseSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  targetType: z.enum(["user", "group"]),
  targetId: z.string(),
  permission: z.enum(["viewer", "editor"]),
  createdAt: z.string(),
});
const pinSchema = z.object({ pinned: z.boolean() });

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

async function assertMoveTargetAllowed(
  c: Context<ProtectedEnv>,
  movingShortId: string,
  targetParentShortId: string | null,
) {
  if (targetParentShortId === null)
    return;
  if (targetParentShortId === movingShortId)
    throw new AppError("A document cannot be its own parent", 400, "INVALID_MOVE");

  await assertParentTargetAllowed(c, targetParentShortId);

  const descendants = await listDescendantIds(c.get("db"), movingShortId);
  if (descendants.includes(targetParentShortId)) {
    throw new AppError("Cannot move a document under its own descendant", 400, "INVALID_MOVE");
  }
}

async function assertParentTargetAllowed(
  c: Context<ProtectedEnv>,
  targetParentShortId: string | null | undefined,
) {
  if (!targetParentShortId)
    return;

  const target = await resolveDocumentItem(c.get("db"), targetParentShortId);
  if (!target)
    throw new NotFoundError("Document", targetParentShortId);

  const ctx = policyContext(c)!;
  await documentAccess.assert(ctx, "document:update", target.id);
}

export function documentRoutes() {
  // Pure Hono. Permission enforcement comes from the global
  // `policyMiddleware` mounted in `app.ts`, driven by the route table
  // declared in `document.permission.ts`.
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.get(
    "/documents",
    describeRoute({
      tags: ["documents"],
      summary: "List my documents",
      responses: {
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(z.object({
            success: z.literal(true),
            data: z.array(documentSchema),
            meta: z.object({ total: z.number(), page: z.number(), limit: z.number() }),
          })) } },
        },
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    validator("query", listQuery, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { q, tag, page: pageRaw, limit: limitRaw } = c.req.valid("query");
      const page = Math.max(1, Math.floor(Number.parseInt(pageRaw ?? "", 10)) || 1);
      const limit = Math.min(100, Math.max(1, Math.floor(Number.parseInt(limitRaw ?? "", 10)) || 20));

      // Documents are owner-scoped: every caller — admins included — sees
      // only their own and explicitly-shared documents.
      const result = await listMyDocuments(db, { userId: user.id, q, tag, page, limit });

      return c.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    },
  );

  router.get(
    "/documents/tree",
    describeRoute({
      tags: ["documents"],
      summary: "Document tree for the current user",
      responses: { 200: okJson(z.array(documentTreeNodeSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const data = await getDocumentTreeForUser(db, user);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/documents/tags",
    describeRoute({
      tags: ["documents"],
      summary: "List all document tags",
      responses: { 200: okJson(z.array(z.string())), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const tags = await listAllTags(db);
      return c.json({ success: true, data: tags });
    },
  );

  router.get(
    "/documents/users",
    describeRoute({
      tags: ["documents"],
      summary: "List active users (share picker)",
      responses: { 200: okJson(z.array(userPickerSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const data = await listActiveUsers(db);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/documents/groups",
    describeRoute({
      tags: ["documents"],
      summary: "List all groups (share picker)",
      responses: { 200: okJson(z.array(groupSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const data = await listAllGroups(db);
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/documents",
    describeRoute({
      tags: ["documents"],
      summary: "Create a document",
      responses: {
        201: okJson(documentSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Parent not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("json", createSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const actor = c.get("user");
      await assertParentTargetAllowed(c, body.parentId);
      const doc = await createDocument(db, { ...body, creatorId: actor.id });
      await audit(db, c.get("logger"), {
        actorId: actor.id,
        actorName: actor.name,
        action: "document.created",
        resourceType: "document",
        resourceId: doc.id,
        resourceName: doc.title,
        ...auditMeta(c),
        result: "success",
      });
      return c.json({ success: true, data: doc }, 201);
    },
  );

  router.get(
    "/documents/:id",
    describeRoute({
      tags: ["documents"],
      summary: "Get a document by id",
      responses: {
        200: okJson(documentSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const doc = await getDocumentById(db, id);
      if (!doc)
        throw new NotFoundError("Document", id);
      // Defense in depth: the global policyMiddleware already gates this,
      // but it falls through when the route-binding registry desyncs or
      // the id doesn't resolve there. Re-assert in-handler so object-level
      // authz never depends solely on the registry. Documents are
      // owner-scoped — admin gets no bypass here. Policy tuples key on the
      // internal item id, so resolve it (doc.id is the short_id).
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // No read access ⇒ hide existence (404), not 403. See decision 003.
      if (!(await documentAccess.can(policyContext(c)!, "document:read", item.id)))
        throw new NotFoundError("Document", id);
      return c.json({ success: true, data: doc });
    },
  );

  router.patch(
    "/documents/:id",
    describeRoute({
      tags: ["documents"],
      summary: "Update a document",
      responses: {
        200: okJson(documentSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        409: { description: "Version conflict", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", updateSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const existing = await getDocumentById(db, id);
      if (!existing)
        throw new NotFoundError("Document", id);

      const body = c.req.valid("json");

      if (body.parentId !== undefined && body.parentId !== existing.parentId) {
        await assertMoveTargetAllowed(c, id, body.parentId);
      }

      // Field-level write policy: `commentsLocked` requires `owner` even
      // though the route action `document:update` admits editors. Letting
      // the framework reject the unauthorised field keeps the lock rule in
      // one place — the resource definition — rather than re-stating it
      // here every time the patch surface changes.
      const ctx = policyContext(c)!;
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      const { version: expectedVersion, ...mutable } = body;
      const safe = await documentAccess.filterWritable(ctx, item.id, mutable, { onForbidden: "reject" });

      const updated = await updateDocument(db, id, { ...safe, expectedVersion });
      if (!updated)
        throw new NotFoundError("Document", id);
      if (isVersionConflict(updated)) {
        return c.json(
          { success: false, error: { code: "VERSION_CONFLICT", message: "Document was modified by another writer" }, data: updated.current },
          409,
        );
      }

      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "document.updated",
        resourceType: "document",
        resourceId: id,
        resourceName: existing.title,
        ...auditMeta(c),
        result: "success",
      });

      return c.json({ success: true, data: updated });
    },
  );

  router.patch(
    "/documents/:id/move",
    describeRoute({
      tags: ["documents"],
      summary: "Move a document under a new parent",
      responses: {
        200: okJson(documentSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", moveSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const existing = await getDocumentById(db, id);
      if (!existing)
        throw new NotFoundError("Document", id);

      const body = c.req.valid("json");
      await assertMoveTargetAllowed(c, id, body.parentId);

      const moved = await updateDocument(db, id, { parentId: body.parentId });
      if (!moved || isVersionConflict(moved))
        throw new NotFoundError("Document", id);

      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "document.updated",
        resourceType: "document",
        resourceId: id,
        resourceName: existing.title,
        detail: { moved: { from: existing.parentId, to: body.parentId } },
        ...auditMeta(c),
        result: "success",
      });

      return c.json({ success: true, data: moved });
    },
  );

  router.delete(
    "/documents/:id",
    describeRoute({
      tags: ["documents"],
      summary: "Delete a document (and its subtree)",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const existing = await getDocumentById(db, id);
      if (!existing)
        throw new NotFoundError("Document", id);
      // Defense in depth (see GET /documents/:id): never let a subtree
      // delete depend solely on the global policy registry.
      const targetItem = await resolveDocumentItem(db, id);
      if (!targetItem)
        throw new NotFoundError("Document", id);
      await documentAccess.assert(policyContext(c)!, "document:delete", targetItem.id);

      const descendantIds = await listDescendantIds(db, id);
      const descendantRows = await Promise.all(descendantIds.map(d => getDocumentById(db, d)));

      // Release every attachment in the subtree before stamping deleted_at —
      // refcounts drain so the async GC reclaims any blobs that were only
      // referenced by the deleted documents.
      const item = await resolveDocumentItem(db, id);
      if (item)
        await releaseAllByOwner(db, c.get("config"), "item_attachment", item.id);
      for (const dId of descendantIds) {
        const dItem = await resolveDocumentItem(db, dId);
        if (dItem)
          await releaseAllByOwner(db, c.get("config"), "item_attachment", dItem.id);
      }

      await softDeleteDocument(db, id);

      const meta = auditMeta(c);
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "document.deleted",
        resourceType: "document",
        resourceId: id,
        resourceName: existing.title,
        ...meta,
        result: "success",
      });
      for (const d of descendantRows) {
        if (!d)
          continue;
        await audit(db, c.get("logger"), {
          actorId: user.id,
          actorName: user.name,
          action: "document.deleted",
          resourceType: "document",
          resourceId: d.id,
          resourceName: d.title,
          detail: { cascadedFrom: id },
          ...meta,
          result: "success",
        });
      }
      return c.json({ success: true, data: null });
    },
  );

  // ── Pin endpoints (per-user) ──

  router.put(
    "/documents/:id/pin",
    describeRoute({
      tags: ["documents"],
      summary: "Pin a document for the current user",
      responses: {
        200: okJson(pinSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // Pin is gated by read access: any user who can see the doc (owner or
      // shared) may pin it for themselves. No read access ⇒ hide existence
      // (404), matching the global policyMiddleware. Decision 003.
      if (!(await documentAccess.can(policyContext(c)!, "document:read", item.id)))
        throw new NotFoundError("Document", id);
      await pinDocument(db, user.id, id);
      return c.json({ success: true, data: { pinned: true } });
    },
  );

  router.delete(
    "/documents/:id/pin",
    describeRoute({
      tags: ["documents"],
      summary: "Unpin a document for the current user",
      responses: {
        200: okJson(pinSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // No read access ⇒ hide existence (404). Decision 003.
      if (!(await documentAccess.can(policyContext(c)!, "document:read", item.id)))
        throw new NotFoundError("Document", id);
      await unpinDocument(db, user.id, id);
      return c.json({ success: true, data: { pinned: false } });
    },
  );

  // ── Attachment endpoints ──

  router.post(
    "/documents/:id/attachments",
    describeRoute({
      tags: ["documents"],
      summary: "Upload a document attachment",
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] },
          },
        },
      },
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const doc = await getDocumentById(db, id);
      if (!doc)
        throw new NotFoundError("Document", id);
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // Defense in depth (see GET /documents/:id).
      await documentAccess.assert(policyContext(c)!, "document:upload", item.id);

      const config = c.get("config");
      const contentLength = Number(c.req.header("content-length") ?? "0");
      if (contentLength > config.MAX_UPLOAD_BYTES) {
        throw new AppError("Upload too large", 413, "UPLOAD_TOO_LARGE");
      }

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new AppError("No file provided", 400, "VALIDATION_ERROR");
      }
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
        action: "document.attachment_uploaded",
        resourceType: "document",
        resourceId: id,
        resourceName: doc.title,
        detail: { attachmentId: reference.id, filename: file.name, size: file.size },
        ...auditMeta(c),
        result: "success",
      });

      return c.json({ success: true, data: view }, 201);
    },
  );

  router.get(
    "/documents/:id/attachments",
    describeRoute({
      tags: ["documents"],
      summary: "List document attachments",
      responses: {
        200: okJson(z.array(attachmentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // No read access ⇒ hide existence (404), not 403. See decision 003.
      if (!(await documentAccess.can(policyContext(c)!, "document:read", item.id)))
        throw new NotFoundError("Document", id);
      const data = await listAttachmentsByOwner(db, "item_attachment", item.id);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/documents/:id/attachments/:aid",
    describeRoute({
      tags: ["documents"],
      summary: "Download a document attachment",
      responses: {
        200: { description: "File stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", attachmentParam, onValidationFailure),
    validator("query", inlineQuery, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id, aid } = c.req.valid("param");
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // No read access ⇒ hide existence (404), not 403. Download is viewer-
      // level for documents, so readability is the existence gate. Decision 003.
      if (!(await documentAccess.can(policyContext(c)!, "document:read", item.id)))
        throw new NotFoundError("Document", id);
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== "item_attachment" || ref.ownerId !== item.id)
        throw new NotFoundError("Attachment", aid);
      const file = await getFileById(db, ref.fileId);
      if (!file)
        throw new NotFoundError("File", aid);
      const wantInline = c.req.valid("query").inline === "true";
      return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
    },
  );

  router.delete(
    "/documents/:id/attachments/:aid",
    describeRoute({
      tags: ["documents"],
      summary: "Delete a document attachment",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", attachmentParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id, aid } = c.req.valid("param");
      const doc = await getDocumentById(db, id);
      if (!doc)
        throw new NotFoundError("Document", id);
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      // Defense in depth (see GET /documents/:id).
      await documentAccess.assert(policyContext(c)!, "document:delete_attachment", item.id);
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== "item_attachment" || ref.ownerId !== item.id)
        throw new NotFoundError("Attachment", aid);
      await releaseReference(db, c.get("config"), { referenceId: aid });
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "document.attachment_deleted",
        resourceType: "document",
        resourceId: id,
        resourceName: doc.title,
        detail: { attachmentId: aid, filename: ref.filename },
        ...auditMeta(c),
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // ── Comments + attachments (delegated to mod-item) ──
  mountItemCommentRoutes(router, {
    routePrefix: "/documents",
    resourceType: "document",
    maxCommentLength: 10000,
    async resolve(db, idParam) {
      const doc = await getDocumentById(db, idParam);
      if (!doc)
        return null;
      const item = await resolveDocumentItem(db, idParam);
      if (!item)
        return null;
      return { item, resource: doc, externalId: idParam, resourceName: doc.title };
    },
    async permissions(db, user, subject) {
      // `mountItemCommentRoutes` predates the policy framework and
      // takes a `(db, user)` hook signature instead of a PolicyContext.
      // Build a minimal ctx so we can ask the framework directly —
      // request metadata is irrelevant for read-only decisions, and
      // the read-only branch never fires onGranted/onRevoked so the
      // shared NOOP_POLICY_LOGGER keeps the type complete without
      // plumbing one in.
      const ctx = {
        db,
        logger: NOOP_POLICY_LOGGER,
        actor: { id: user.id, type: "user", role: user.role },
      };
      const canView = await documentAccess.can(ctx, "document:read_comments", subject.item.id);
      return {
        canRead: canView,
        canPost: canView && !subject.resource.commentsLocked,
        // Documents do not currently distinguish internal vs public
        // comments. `item_comments.is_internal` defaults to `false`
        // (set by ItemService.createComment), so passing `true` is safe
        // and forward-compatible — the day the sub-type wants to flip
        // some comments to internal, viewer-only callers will still be
        // shielded if this flag is recomputed.
        includeInternal: true,
        canDelete: authorId => user.role === "admin" || authorId === user.id,
      };
    },
  });

  // ── Share endpoints (policy tuples) ──

  router.get(
    "/documents/:id/shares",
    describeRoute({
      tags: ["documents"],
      summary: "List document shares (with inheritance)",
      responses: {
        200: okJson(z.array(shareWithSourceSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      // This handler previously had NO in-handler check at all and leaked
      // the (inherited) sharing graph to any authenticated user if the
      // policy binding desynced. Resolve + assert document:manage (owner)
      // explicitly; documents are owner-scoped, so admin gets no bypass.
      const item = await resolveDocumentItem(db, id);
      if (!item)
        throw new NotFoundError("Document", id);
      const ctx = policyContext(c)!;
      // No read access ⇒ 404 (hide existence); a reader who is not the owner
      // lacks `manage` ⇒ 403. Decision 003.
      if (!(await documentAccess.can(ctx, "document:read", item.id)))
        throw new NotFoundError("Document", id);
      await documentAccess.assert(ctx, "document:manage", item.id);
      const data = await listDocumentSharesWithInheritance(db, id);
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/documents/:id/shares",
    describeRoute({
      tags: ["documents"],
      summary: "Share a document with a user or group",
      responses: {
        201: okJson(shareResponseSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", shareSchema, onValidationFailure),
    async (c) => {
      const ctx = policyContext(c)!;
      const { id } = c.req.valid("param");

      const body = c.req.valid("json");
      // The framework runs `canGrant` (owner-or-admin) and `onGranted`
      // (audit emission) inside `documentAccess.grant()` — no manual
      // permission check or audit call here.
      const share = await addDocumentShare(ctx, { documentId: id, ...body });

      return c.json(
        {
          success: true,
          data: share,
          note: "Share applies recursively to all descendant documents.",
        },
        201,
      );
    },
  );

  router.delete(
    "/documents/:id/shares/:shareId",
    describeRoute({
      tags: ["documents"],
      summary: "Remove a document share",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", shareParam, onValidationFailure),
    async (c) => {
      const ctx = policyContext(c)!;
      const { id, shareId } = c.req.valid("param");

      const share = await getDocumentShareById(c.get("db"), shareId);
      if (!share || share.documentId !== id)
        throw new NotFoundError("Share", shareId);

      // `onRevoked` audits the removal; no manual audit emission needed.
      await removeDocumentShare(ctx, shareId);

      return c.json({ success: true, data: null });
    },
  );

  // Anonymous public-link access now lives in the unified share module
  // (`modules/share`): public links are `shares` rows with
  // `resource_type='document'`, managed via `/shares/document/:id` and
  // served via `/shared/:token`. Collaborator (viewer/editor) grants above
  // remain policy tuples.

  return router;
}
