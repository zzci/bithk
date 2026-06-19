import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { assertEntryCapability } from "@/modules/drive/drive.permission";
import { getDriveEntryById } from "@/modules/drive/drive.service";
import {
  addReference,
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
import { hasCapability, isMember as isProjectMember, resolveProjectId } from "@/modules/project/project.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
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

// Treat an empty query value (`?status=`) as absent, preserving the previous
// `c.req.query("x") || undefined` normalization before the schema validates.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

// Bounded list-query schema for the list edge: caps `q` length and validates
// status / priority against their enums (invalid → 422 instead of silently
// dropped). `categoryId` is bounded; pagination uses `parsePageQuery`.
const listQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(PROCUREMENT_STATUSES).optional()),
  priority: z.preprocess(emptyToUndefined, z.enum(PROCUREMENT_PRIORITIES).optional()),
  categoryId: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
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
const procurementParam = z.object({ projectId: z.string(), id: z.string() });
const attachmentParam = z.object({ projectId: z.string(), id: z.string(), aid: z.string() });
const inlineQuery = z.object({ inline: z.string().optional() });

// Mirrors `ProcurementRow` returned by the procurement service.
const tagRefSchema = z.object({ id: z.string(), name: z.string() });
const procurementSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  itemName: z.string(),
  status: z.enum(PROCUREMENT_STATUSES),
  supplierId: z.string().nullable(),
  categoryId: z.string().nullable(),
  assigneeMemberId: z.string().nullable(),
  quantity: z.number().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  priority: z.enum(PROCUREMENT_PRIORITIES),
  dueDate: z.string().nullable(),
  creatorId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  pinned: z.boolean(),
  pinnedAt: z.string().nullable(),
  tags: z.array(tagRefSchema),
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
// Attach an already-stored drive file by entry id (no re-upload).
const fromDriveSchema = z.object({ entryId: z.string().min(1) });

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

function actorId(c: Context<ProtectedEnv>): string {
  return c.get("user").id;
}

function auditMeta(c: Context<ProtectedEnv>) {
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
async function requireProcurementAccess(c: Context<ProtectedEnv>, projectShortId: string, needManage = false): Promise<string> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, projectShortId);
  if (!projectId)
    throw new NotFoundError("Project", projectShortId);
  // App admins bypass project membership and procurement capabilities entirely.
  if (c.get("user").role === "admin")
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
async function requireProcurement(c: Context<ProtectedEnv>, projectShortId: string, procurementShortId: string, needManage = false) {
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
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── List ──────────────────────────────────────────────────────────
  router.get(
    "/projects/:projectId/procurements",
    describeRoute({
      tags: ["procurements"],
      summary: "List a project's procurements",
      responses: {
        200: okListJson(procurementSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not visible", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const projectId = await requireProcurementAccess(c, c.req.valid("param").projectId);
      const db = c.get("db");
      const { q, status, priority, categoryId } = c.req.valid("query");
      const tagIds = parseTagIds(c.req.queries("tagIds"));
      const { page, limit } = parsePageQuery(c, { limit: 20 });
      const result = await listByProject(db, projectId, { q, status, priority, categoryId, tagIds, page, limit });
      return c.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    },
  );

  // ─── Create ────────────────────────────────────────────────────────
  router.post(
    "/projects/:projectId/procurements",
    describeRoute({
      tags: ["procurements"],
      summary: "Create a procurement",
      responses: {
        201: okJson(procurementSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not manageable", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("json", createSchema, onValidationFailure),
    async (c) => {
      const projectId = await requireProcurementAccess(c, c.req.valid("param").projectId, true);
      const db = c.get("db");
      const body = c.req.valid("json");
      const procurement = await createProcurement(db, { ...body, projectId, creatorId: actorId(c) });
      return c.json({ success: true, data: procurement }, 201);
    },
  );

  // ─── Detail ────────────────────────────────────────────────────────
  router.get(
    "/projects/:projectId/procurements/:id",
    describeRoute({
      tags: ["procurements"],
      summary: "Get a procurement",
      responses: {
        200: okJson(procurementSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Procurement not found", ...errorJson },
      },
    }),
    validator("param", procurementParam, onValidationFailure),
    async (c) => {
      const { projectId, id } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id);
      return c.json({ success: true, data: procurement });
    },
  );

  // ─── Update ────────────────────────────────────────────────────────
  router.patch(
    "/projects/:projectId/procurements/:id",
    describeRoute({
      tags: ["procurements"],
      summary: "Update a procurement",
      responses: {
        200: okJson(procurementSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Procurement not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", procurementParam, onValidationFailure),
    validator("json", updateSchema, onValidationFailure),
    async (c) => {
      const { projectId, id } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id, true);
      const db = c.get("db");
      const body = c.req.valid("json");
      const updated = await updateProcurement(db, procurement.id, body);
      if (!updated)
        throw new NotFoundError("Procurement", procurement.id);
      return c.json({ success: true, data: updated });
    },
  );

  // Procurement is intentionally non-deletable: there is no DELETE route. A
  // procurement that is no longer relevant is moved to the `cancelled` status
  // instead, preserving its audit trail and references.

  // ─── Pin / Unpin ───────────────────────────────────────────────────
  // Curation action gated on `procurement.manage` (admins bypass), same as the
  // other procurement mutations. `requireProcurement(needManage=true)` also
  // fail-closes non-members and view-only members to 404.
  for (const pinned of [true, false] as const) {
    router.post(
      `/projects/:projectId/procurements/:id/${pinned ? "pin" : "unpin"}`,
      describeRoute({
        tags: ["procurements"],
        summary: `${pinned ? "Pin" : "Unpin"} a procurement`,
        responses: {
          200: okJson(procurementSchema),
          401: { description: "Unauthenticated", ...errorJson },
          404: { description: "Procurement not found", ...errorJson },
        },
      }),
      validator("param", procurementParam, onValidationFailure),
      async (c) => {
        const { projectId, id } = c.req.valid("param");
        const { procurement } = await requireProcurement(c, projectId, id, true);
        const db = c.get("db");
        const item = await resolveProcurementItem(db, procurement.id);
        if (!item)
          throw new NotFoundError("Procurement", procurement.id);
        await setItemPinned(db, item.id, pinned);
        const updated = await getProcurementByShortId(db, procurement.id);
        if (!updated)
          throw new NotFoundError("Procurement", procurement.id);
        return c.json({ success: true, data: updated });
      },
    );
  }

  // ─── Status change ─────────────────────────────────────────────────
  router.post(
    "/projects/:projectId/procurements/:id/status",
    describeRoute({
      tags: ["procurements"],
      summary: "Change a procurement's status",
      responses: {
        200: okJson(procurementSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Procurement not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", procurementParam, onValidationFailure),
    validator("json", statusSchema, onValidationFailure),
    async (c) => {
      const { projectId, id } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id, true);
      const db = c.get("db");
      const user = c.get("user");
      const body = c.req.valid("json");
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
    },
  );

  // ─── Attachments (main-post, delegating to mod-file) ──────────────
  // Resource-level attachments are owned by the procurement's backing item
  // (ownerType "item_attachment"), mirroring the issue attachment routes.
  router.post(
    "/projects/:projectId/procurements/:id/attachments",
    describeRoute({
      tags: ["procurements"],
      summary: "Upload a procurement attachment",
      requestBody: fileUploadBody,
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Procurement not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
      },
    }),
    validator("param", procurementParam, onValidationFailure),
    async (c) => {
      const { projectId, id } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id, true);
      const db = c.get("db");
      const user = c.get("user");
      const item = await resolveProcurementItem(db, procurement.id);
      if (!item)
        throw new NotFoundError("Procurement", procurement.id);

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
        action: "procurement.attachment_uploaded",
        resourceType: "procurement",
        resourceId: procurement.id,
        resourceName: procurement.itemName,
        detail: { attachmentId: reference.id, filename: file.name, size: file.size },
        ...auditMeta(c),
        result: "success",
      });

      return c.json({ success: true, data: view }, 201);
    },
  );

  // Attach an existing drive file to this procurement without re-uploading the
  // blob: register a new reference to the entry's already-stored file. The
  // actor's READ access on the drive entry is verified server-side — the
  // client-supplied id is never trusted.
  router.post(
    "/projects/:projectId/procurements/:id/attachments/from-drive",
    describeRoute({
      tags: ["procurements"],
      summary: "Attach a drive file to a procurement",
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "Drive entry is not a file or already attached", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", procurementParam, onValidationFailure),
    validator("json", fromDriveSchema, onValidationFailure),
    async (c) => {
      const { projectId, id } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id, true);
      const db = c.get("db");
      const user = c.get("user");
      const item = await resolveProcurementItem(db, procurement.id);
      if (!item)
        throw new NotFoundError("Procurement", procurement.id);
      const { entryId } = c.req.valid("json");

      // Authoritative READ check on the drive entry (throws 404/403).
      const actor = { id: user.id, role: user.role };
      await assertEntryCapability(db, actor, entryId, "read");
      const entry = await getDriveEntryById(db, entryId);
      if (!entry || !entry.file)
        throw new AppError("Drive entry is not a file", 400, "INVALID_ENTRY");

      const reference = await addReference(db, {
        fileId: entry.file.fileId,
        ownerType: "item_attachment",
        ownerId: item.id,
        filename: entry.name,
        createdBy: user.id,
      });
      const fileRow = await getFileById(db, entry.file.fileId);
      const view = makeAttachmentView(reference, fileRow!);

      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "procurement.attachment_attached_from_drive",
        resourceType: "procurement",
        resourceId: procurement.id,
        resourceName: procurement.itemName,
        detail: { attachmentId: reference.id, entryId, filename: entry.name },
        ...auditMeta(c),
        result: "success",
      });

      return c.json({ success: true, data: view }, 201);
    },
  );

  router.get(
    "/projects/:projectId/procurements/:id/attachments",
    describeRoute({
      tags: ["procurements"],
      summary: "List procurement attachments",
      responses: {
        200: okJson(z.array(attachmentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Procurement not found", ...errorJson },
      },
    }),
    validator("param", procurementParam, onValidationFailure),
    async (c) => {
      const { projectId, id } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id);
      const db = c.get("db");
      const item = await resolveProcurementItem(db, procurement.id);
      if (!item)
        throw new NotFoundError("Procurement", procurement.id);
      const data = await listAttachmentsByOwner(db, "item_attachment", item.id);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/projects/:projectId/procurements/:id/attachments/:aid",
    describeRoute({
      tags: ["procurements"],
      summary: "Download a procurement attachment",
      responses: {
        200: { description: "Attachment file stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Attachment not found", ...errorJson },
      },
    }),
    validator("param", attachmentParam, onValidationFailure),
    validator("query", inlineQuery, onValidationFailure),
    async (c) => {
      const { projectId, id, aid } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id);
      const db = c.get("db");
      const item = await resolveProcurementItem(db, procurement.id);
      if (!item)
        throw new NotFoundError("Procurement", procurement.id);
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
    "/projects/:projectId/procurements/:id/attachments/:aid",
    describeRoute({
      tags: ["procurements"],
      summary: "Delete a procurement attachment",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Attachment not found", ...errorJson },
      },
    }),
    validator("param", attachmentParam, onValidationFailure),
    async (c) => {
      const { projectId, id, aid } = c.req.valid("param");
      const { procurement } = await requireProcurement(c, projectId, id);
      const db = c.get("db");
      const user = c.get("user");
      const item = await resolveProcurementItem(db, procurement.id);
      if (!item)
        throw new NotFoundError("Procurement", procurement.id);
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== "item_attachment" || ref.ownerId !== item.id)
        throw new NotFoundError("Attachment", aid);

      // `procurement.projectId` is the project short_id; the capability helpers
      // key on the internal ULID, so resolve it first.
      const realProjectId = await resolveProjectId(db, procurement.projectId);
      const allowed = user.role === "admin"
        || (!!realProjectId && await hasCapability(db, realProjectId, user.id, "procurement.manage"))
        || ref.createdBy === user.id;
      if (!allowed)
        throw new ForbiddenError();

      await releaseReference(db, c.get("config"), { referenceId: aid });
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "procurement.attachment_deleted",
        resourceType: "procurement",
        resourceId: procurement.id,
        resourceName: procurement.itemName,
        detail: { attachmentId: aid, filename: ref.filename },
        ...auditMeta(c),
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

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
