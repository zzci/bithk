import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
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
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { hrApprovalsRoutes } from "./hr.approvals.routes";
import { hrPayrollRoutes } from "./hr.payroll.routes";
import {
  archiveColleague,
  createColleague,
  getColleagueById,
  listColleagues,
  updateColleague,
} from "./hr.service";
import { HR_COLLEAGUE_STATUSES, HR_EMPLOYMENT_TYPES, HR_GENDERS } from "./schema";

// Personal documents (passport / certificates / etc.) attach to the file
// module's generic registry under this discriminator — no per-module table.
const COLLEAGUE_DOC_OWNER_TYPE = "hr_colleague_document";

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(HR_COLLEAGUE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// `YYYY-MM-DD` or empty (the edit form clears a date by sending "").
const dateField = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/, "Expected YYYY-MM-DD");

const paymentFieldSchema = z.object({
  label: z.string().max(100),
  value: z.string().max(500),
});

const emergencyContactSchema = z.object({
  name: z.string().max(100),
  relation: z.string().max(100),
  phone: z.string().max(50),
  email: z.string().max(200),
  address: z.string().max(500),
});

// Shared optional profile fields for create and update. Enums are nullable so
// the form can clear a selection (null) without affecting other fields.
const profileFields = {
  code: z.string().max(100).optional(),
  title: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  birthday: dateField.optional(),
  hireDate: dateField.optional(),
  probationEndDate: dateField.optional(),
  contractEndDate: dateField.optional(),
  gender: z.enum(HR_GENDERS).nullable().optional(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).nullable().optional(),
  nationality: z.string().max(200).optional(),
  personalPhone: z.string().max(50).optional(),
  personalEmail: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  workLocation: z.string().max(200).optional(),
  salaryAmount: z.number().int().min(0).nullable().optional(),
  salaryCurrency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase code").nullable().optional(),
  paymentInfo: z.array(paymentFieldSchema).max(30).optional(),
  emergencyContacts: z.array(emergencyContactSchema).max(20).optional(),
} as const;

const createBodySchema = z.object({
  userId: z.string().min(1).max(100),
  ...profileFields,
});

const updateBodySchema = z.object({
  userId: z.string().min(1).max(100).optional(),
  status: z.enum(HR_COLLEAGUE_STATUSES).optional(),
  ...profileFields,
}).refine(
  d => Object.values(d).some(v => v !== undefined),
  { message: "At least one field must be provided" },
);

const idParamSchema = z.object({ id: z.string() });
const attachmentParamSchema = z.object({ id: z.string(), aid: z.string() });
const downloadQuerySchema = z.object({ inline: z.string().optional() });
// Attach an already-stored drive file by entry id (no re-upload).
const fromDriveSchema = z.object({ entryId: z.string().min(1) });

// Response data shapes (mirror the service views) for the generated spec.
const userBriefSchema = z.object({
  name: z.string(),
  username: z.string(),
  isVirtual: z.boolean(),
  status: z.enum(["active", "disabled"]),
});
const colleagueViewSchema = z.object({
  id: z.string(),
  userId: z.string(),
  code: z.string().nullable(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  status: z.enum(HR_COLLEAGUE_STATUSES),
  notes: z.string().nullable(),
  birthday: z.string().nullable(),
  hireDate: z.string().nullable(),
  probationEndDate: z.string().nullable(),
  contractEndDate: z.string().nullable(),
  gender: z.enum(HR_GENDERS).nullable(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).nullable(),
  nationality: z.string().nullable(),
  personalPhone: z.string().nullable(),
  personalEmail: z.string().nullable(),
  address: z.string().nullable(),
  workLocation: z.string().nullable(),
  salaryAmount: z.number().int().min(0).nullable(),
  salaryCurrency: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  paymentInfo: z.array(paymentFieldSchema),
  emergencyContacts: z.array(emergencyContactSchema),
  user: userBriefSchema,
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
const pageMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
// `{ success:true, data:[…], meta }` response doc for a paginated list.
function paginatedJson(itemSchema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: z.array(itemSchema), meta: pageMetaSchema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

export function hrRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // ── /hr/colleagues — colleague management ──
  // Access is owned by the protected router's module gate: non-admins need
  // the `hr` module on their global role (the default Member role excludes
  // it), admins bypass. No per-route adminRequired wrap here.

  router.get(
    "/hr/colleagues",
    describeRoute({
      tags: ["hr"],
      summary: "List colleagues",
      responses: {
        200: paginatedJson(colleagueViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const query = c.req.valid("query");
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
    },
  );

  router.post(
    "/hr/colleagues",
    describeRoute({
      tags: ["hr"],
      summary: "Create a colleague",
      responses: {
        201: okJson(colleagueViewSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("json", createBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const created = await createColleague(db, body);
      return c.json({ success: true, data: created }, 201);
    },
  );

  router.patch(
    "/hr/colleagues/:id",
    describeRoute({
      tags: ["hr"],
      summary: "Update a colleague",
      responses: {
        200: okJson(colleagueViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const updated = await updateColleague(db, id, body);
      return c.json({ success: true, data: updated });
    },
  );

  // DELETE archives instead of hard-deleting — see archiveColleague.
  router.delete(
    "/hr/colleagues/:id",
    describeRoute({
      tags: ["hr"],
      summary: "Archive a colleague",
      responses: {
        200: okJson(colleagueViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const archived = await archiveColleague(db, id);
      return c.json({ success: true, data: archived });
    },
  );

  // ── /hr/colleagues/:id/attachments — personal documents ──
  // Delegates to the file module's generic attachment registry (ownerType
  // COLLEAGUE_DOC_OWNER_TYPE), mirroring the procurement/issue attachment
  // routes. Access stays under the HR module gate above.

  router.post(
    "/hr/colleagues/:id/attachments",
    describeRoute({
      tags: ["hr"],
      summary: "Upload a colleague document",
      requestBody: { content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } } },
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id: colleagueId } = c.req.valid("param");
      const colleague = await getColleagueById(db, colleagueId);
      if (!colleague)
        throw new NotFoundError("HR colleague", colleagueId);

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
        ownerType: COLLEAGUE_DOC_OWNER_TYPE,
        ownerId: colleagueId,
        uploadedBy: user.id,
      });
      return c.json({ success: true, data: makeAttachmentView(reference, uploaded) }, 201);
    },
  );

  // Attach an existing drive file as a colleague document without re-uploading
  // the blob: register a new reference to the entry's already-stored file. The
  // actor's READ access on the drive entry is verified server-side — the
  // client-supplied id is never trusted.
  router.post(
    "/hr/colleagues/:id/attachments/from-drive",
    describeRoute({
      tags: ["hr"],
      summary: "Attach a drive file as a colleague document",
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "Drive entry is not a file or already attached", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", fromDriveSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id: colleagueId } = c.req.valid("param");
      const { entryId } = c.req.valid("json");
      const colleague = await getColleagueById(db, colleagueId);
      if (!colleague)
        throw new NotFoundError("HR colleague", colleagueId);

      // Authoritative READ check on the drive entry (throws 404/403).
      const actor = { id: user.id, role: user.role };
      await assertEntryCapability(db, actor, entryId, "read");
      const entry = await getDriveEntryById(db, entryId);
      if (!entry || !entry.file)
        throw new AppError("Drive entry is not a file", 400, "INVALID_ENTRY");

      const reference = await addReference(db, {
        fileId: entry.file.fileId,
        ownerType: COLLEAGUE_DOC_OWNER_TYPE,
        ownerId: colleagueId,
        filename: entry.name,
        createdBy: user.id,
      });
      const fileRow = await getFileById(db, entry.file.fileId);
      return c.json({ success: true, data: makeAttachmentView(reference, fileRow!) }, 201);
    },
  );

  router.get(
    "/hr/colleagues/:id/attachments",
    describeRoute({
      tags: ["hr"],
      summary: "List colleague documents",
      responses: {
        200: okJson(z.array(attachmentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: colleagueId } = c.req.valid("param");
      const colleague = await getColleagueById(db, colleagueId);
      if (!colleague)
        throw new NotFoundError("HR colleague", colleagueId);
      const data = await listAttachmentsByOwner(db, COLLEAGUE_DOC_OWNER_TYPE, colleagueId);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/hr/colleagues/:id/attachments/:aid",
    describeRoute({
      tags: ["hr"],
      summary: "Download a colleague document",
      responses: {
        200: { description: "File stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", attachmentParamSchema, onValidationFailure),
    validator("query", downloadQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: colleagueId, aid } = c.req.valid("param");
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== COLLEAGUE_DOC_OWNER_TYPE || ref.ownerId !== colleagueId)
        throw new NotFoundError("Attachment", aid);
      const file = await getFileById(db, ref.fileId);
      if (!file)
        throw new NotFoundError("File", aid);
      const wantInline = c.req.valid("query").inline === "true";
      return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
    },
  );

  router.delete(
    "/hr/colleagues/:id/attachments/:aid",
    describeRoute({
      tags: ["hr"],
      summary: "Delete a colleague document",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", attachmentParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id: colleagueId, aid } = c.req.valid("param");
      const ref = await getReferenceById(db, aid);
      if (!ref || ref.ownerType !== COLLEAGUE_DOC_OWNER_TYPE || ref.ownerId !== colleagueId)
        throw new NotFoundError("Attachment", aid);

      // An admin or the uploader may remove a document.
      if (user.role !== "admin" && ref.createdBy !== user.id)
        throw new ForbiddenError();

      await releaseReference(db, c.get("config"), { referenceId: aid });
      return c.json({ success: true, data: null });
    },
  );

  // Sub-module routers share this router's `authRequired` gate above.
  router.route("/", hrApprovalsRoutes());
  router.route("/", hrPayrollRoutes());

  return router;
}
