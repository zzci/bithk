import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import {
  buildDownloadResponse,
  getFileById,
  getReferenceById,
  listAttachmentsByOwner,
  makeAttachmentView,
  releaseReference,
  uploadAndReference,
} from "@/modules/file";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
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

  // ── /hr/colleagues/:id/attachments — personal documents ──
  // Delegates to the file module's generic attachment registry (ownerType
  // COLLEAGUE_DOC_OWNER_TYPE), mirroring the procurement/issue attachment
  // routes. Access stays under the HR module gate above.

  router.post("/hr/colleagues/:id/attachments", async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const colleagueId = c.req.param("id");
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
  });

  router.get("/hr/colleagues/:id/attachments", async (c) => {
    const db = c.get("db");
    const colleagueId = c.req.param("id");
    const colleague = await getColleagueById(db, colleagueId);
    if (!colleague)
      throw new NotFoundError("HR colleague", colleagueId);
    const data = await listAttachmentsByOwner(db, COLLEAGUE_DOC_OWNER_TYPE, colleagueId);
    return c.json({ success: true, data });
  });

  router.get("/hr/colleagues/:id/attachments/:aid", async (c) => {
    const db = c.get("db");
    const colleagueId = c.req.param("id");
    const aid = c.req.param("aid");
    const ref = await getReferenceById(db, aid);
    if (!ref || ref.ownerType !== COLLEAGUE_DOC_OWNER_TYPE || ref.ownerId !== colleagueId)
      throw new NotFoundError("Attachment", aid);
    const file = await getFileById(db, ref.fileId);
    if (!file)
      throw new NotFoundError("File", aid);
    const wantInline = c.req.query("inline") === "true";
    return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
  });

  router.delete("/hr/colleagues/:id/attachments/:aid", async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const colleagueId = c.req.param("id");
    const aid = c.req.param("aid");
    const ref = await getReferenceById(db, aid);
    if (!ref || ref.ownerType !== COLLEAGUE_DOC_OWNER_TYPE || ref.ownerId !== colleagueId)
      throw new NotFoundError("Attachment", aid);

    // An admin or the uploader may remove a document.
    if (user.role !== "admin" && ref.createdBy !== user.id)
      throw new ForbiddenError();

    await releaseReference(db, c.get("config"), { referenceId: aid });
    return c.json({ success: true, data: null });
  });

  // Sub-module routers share this router's `authRequired` gate above.
  router.route("/", hrApprovalsRoutes());
  router.route("/", hrPayrollRoutes());

  return router;
}
