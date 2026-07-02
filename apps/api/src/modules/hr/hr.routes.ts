import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { mountItemAttachmentRoutes } from "@/modules/item/attachment.routes";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, pageMetaSchema, validator } from "@/shared/lib/openapi";
import { pageQueryFields } from "@/shared/lib/pagination";
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
  ...pageQueryFields({ defaultLimit: 20, maxLimit: 100 }),
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
const hrPageMetaSchema = pageMetaSchema.extend({ totalPages: z.number() });

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
        200: okListJson(colleagueViewSchema, "Success", hrPageMetaSchema),
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
  // Delegates to the shared item attachment factory (ownerType
  // COLLEAGUE_DOC_OWNER_TYPE). Access stays under the HR module gate above:
  // anyone who passes it may read and upload; only an admin or the uploader
  // may delete. `writeDenial: "not-found"` keeps the generated spec free of
  // a 403 the upload route can never return (there is no write gate to deny).
  // Deliberate difference: colleague documents were never audited, so the
  // factory's audit emission stays off to preserve pre-factory behavior.
  mountItemAttachmentRoutes(router, {
    routePrefix: "/hr/colleagues",
    resourceType: "HR colleague",
    tag: "hr",
    ownerType: COLLEAGUE_DOC_OWNER_TYPE,
    writeDenial: "not-found",
    auditEnabled: false,
    summaries: {
      upload: "Upload a colleague document",
      fromDrive: "Attach a drive file as a colleague document",
      list: "List colleague documents",
      download: "Download a colleague document",
      delete: "Delete a colleague document",
    },
    async resolve(db, idParam) {
      const colleague = await getColleagueById(db, idParam);
      if (!colleague)
        return null;
      return { ownerId: colleague.id, resource: colleague, externalId: colleague.id, resourceName: colleague.user.name };
    },
    async permissions(_db, user) {
      return {
        canRead: true,
        canWrite: true,
        // An admin or the uploader may remove a document.
        canDelete: createdBy => user.role === "admin" || createdBy === user.id,
      };
    },
  });

  // Sub-module routers share this router's `authRequired` gate above.
  router.route("/", hrApprovalsRoutes());
  router.route("/", hrPayrollRoutes());

  return router;
}
