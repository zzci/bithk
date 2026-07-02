import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { AppError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { parsePageQuery } from "@/shared/lib/pagination";
import { parseTagIds } from "@/shared/lib/route-params";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  composeContactCategory,
  createContactCategory,
  deleteContactCategory,
  listContactCategories,
  resolveContactCategory,
  updateContactCategory,
} from "./contact-category.service";
import * as contactService from "./contact.service";
import { CONTACT_KINDS, CONTACT_SENSITIVITIES, CONTACT_STATUSES, CONTACT_VISIBILITIES } from "./schema";

const idParamSchema = z.object({ id: z.string().min(1) });

// Free-form extra fields: a flat map of string keys (≤200) to string values
// (≤2000), capped at 50 keys. Nested objects / arrays are rejected by z.record.
const attributesSchema = z
  .record(z.string().max(200), z.string().max(2000))
  .refine(v => Object.keys(v).length <= 50, { message: "At most 50 attribute keys allowed" })
  .nullable()
  .optional();

// Company fields seeded onto an organization created inline from
// `organizationName` (individual-only; ignored without a new org name).
const organizationAttributesSchema = z.object({
  website: z.string().trim().max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  taxId: z.string().trim().max(255).nullable().optional(),
}).optional();

// Fields shared by both kinds: phone, email, website, taxId, address, note,
// plus classification/visibility metadata.
const commonContactFields = {
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  taxId: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  visibility: z.enum(CONTACT_VISIBILITIES).optional(),
  confidential: z.boolean().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).optional(),
  attributes: attributesSchema,
};

const individualBodySchema = z.object({
  kind: z.literal("individual"),
  position: z.string().trim().max(255).nullable().optional(),
  organizationId: z.string().trim().min(1).nullable().optional(),
  organizationName: z.string().trim().max(255).nullable().optional(),
  organizationAttributes: organizationAttributesSchema,
  ...commonContactFields,
});

const organizationBodySchema = z.object({
  kind: z.literal("organization"),
  ...commonContactFields,
});

// A contact must carry at least one reachable channel — a phone OR an email.
// Website/address/taxId don't count. Enforced on CREATE only; the update body
// (below) stays name-only so editing an existing contact is unaffected.
const contactBodySchema = z
  .discriminatedUnion("kind", [individualBodySchema, organizationBodySchema])
  .refine(v => !!v.phone?.trim() || !!v.email?.trim(), {
    message: "A contact requires a phone or email",
    path: ["phone"],
  });

// `kind` is immutable, so the update body omits it; the service validates the
// provided fields against the stored kind. Accepts the union of both kinds'
// fields, all optional.
const updateBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  position: z.string().trim().max(255).nullable().optional(),
  organizationId: z.string().trim().min(1).nullable().optional(),
  organizationName: z.string().trim().max(255).nullable().optional(),
  organizationAttributes: organizationAttributesSchema,
  taxId: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  visibility: z.enum(CONTACT_VISIBILITIES).optional(),
  confidential: z.boolean().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).optional(),
  attributes: attributesSchema,
}).refine(v => Object.keys(v).length > 0, {
  message: "At least one field must be provided",
});

const createContactCategorySchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const updateContactCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

const grantTargetSchema = z.object({
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
}).refine(v => (v.userId === undefined) !== (v.groupId === undefined), {
  message: "Provide exactly one of userId or groupId",
});

// ─── Response doc schemas (mirror the service view shapes) ──────────
const contactCategoryViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const contactTagViewSchema = z.object({ id: z.string(), name: z.string() });

const contactOrganizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  taxId: z.string().nullable(),
});

const contactViewSchema = z.object({
  id: z.string(),
  kind: z.enum(CONTACT_KINDS),
  ownerId: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  position: z.string().nullable(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  organization: contactOrganizationSummarySchema.nullable(),
  taxId: z.string().nullable(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  attributes: z.record(z.string(), z.string()).nullable(),
  avatarReferenceId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  categoryId: z.string().nullable(),
  status: z.enum(CONTACT_STATUSES).nullable(),
  visibility: z.enum(CONTACT_VISIBILITIES),
  confidential: z.boolean(),
  tags: z.array(contactTagViewSchema),
  canManage: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function actorOf(c: Context<ProtectedEnv>) {
  const user = c.get("user");
  return { id: user.id, role: user.role };
}

function grantTarget(body: z.infer<typeof grantTargetSchema>): contactService.ContactGrantTarget {
  if (body.userId !== undefined)
    return { type: "user", id: body.userId };
  if (body.groupId !== undefined)
    return { type: "group", id: body.groupId };
  throw new ValidationError("Invalid contact share target", { target: "Provide exactly one of userId or groupId" });
}

export function contactRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── Global contact categories (admin only) ────────────────────────
  // A standalone, admin-maintained vocabulary referenced by `contacts.category_id`.
  router.get(
    "/contact-categories",
    describeRoute({
      tags: ["contacts"],
      summary: "List contact categories",
      responses: {
        200: okJson(z.array(contactCategoryViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      return c.json({ success: true, data: (await listContactCategories(db)).map(composeContactCategory) });
    },
  );

  router.post(
    "/contact-categories",
    describeRoute({
      tags: ["contacts"],
      summary: "Create a contact category",
      responses: {
        201: okJson(contactCategoryViewSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("json", createContactCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await createContactCategory(db, body);
      await auditFromCtx(c, {
        action: "contact_category.created",
        resourceType: "contact_category",
        resourceId: category.id,
        resourceName: category.name,
        result: "success",
      });
      return c.json({ success: true, data: composeContactCategory(category) }, 201);
    },
  );

  router.patch(
    "/contact-categories/:id",
    describeRoute({
      tags: ["contacts"],
      summary: "Update a contact category",
      responses: {
        200: okJson(contactCategoryViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateContactCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const category = await updateContactCategory(db, id, body);
      if (!category)
        throw new NotFoundError("Contact category", id);
      await auditFromCtx(c, {
        action: "contact_category.updated",
        resourceType: "contact_category",
        resourceId: category.id,
        resourceName: category.name,
        result: "success",
      });
      return c.json({ success: true, data: composeContactCategory(category) });
    },
  );

  router.delete(
    "/contact-categories/:id",
    describeRoute({
      tags: ["contacts"],
      summary: "Delete a contact category",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const category = await resolveContactCategory(db, id);
      if (!category || !await deleteContactCategory(db, id))
        throw new NotFoundError("Contact category", id);
      await auditFromCtx(c, {
        action: "contact_category.deleted",
        resourceType: "contact_category",
        resourceId: category.id,
        resourceName: category.name,
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  router.get(
    "/contacts",
    describeRoute({
      tags: ["contacts"],
      summary: "List contacts",
      parameters: [
        { name: "tagIds", in: "query", required: false, description: "Repeatable or comma-separated tag ids (max 50)", schema: { type: "string" } },
        { name: "categoryId", in: "query", required: false, schema: { type: "string" } },
        { name: "q", in: "query", required: false, description: "Free-text search over name/contact fields", schema: { type: "string" } },
        { name: "status", in: "query", required: false, schema: { type: "string", enum: [...CONTACT_STATUSES] } },
        { name: "kind", in: "query", required: false, schema: { type: "string", enum: [...CONTACT_KINDS] } },
        { name: "sensitivity", in: "query", required: false, schema: { type: "string", enum: [...CONTACT_SENSITIVITIES] } },
        { name: "page", in: "query", required: false, description: "1-based page; enables pagination when present", schema: { type: "integer", minimum: 1 } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: {
        200: okListJson(contactViewSchema, "Contacts page"),
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    async (c) => {
      const tagIds = parseTagIds(c.req.queries("tagIds"));
      const categoryId = c.req.query("categoryId")?.trim() || undefined;
      const qRaw = c.req.query("q")?.trim();
      const q = qRaw || undefined;
      const statusRaw = c.req.query("status");
      const status = statusRaw && (CONTACT_STATUSES as readonly string[]).includes(statusRaw)
        ? statusRaw as (typeof CONTACT_STATUSES)[number]
        : undefined;
      const kindRaw = c.req.query("kind");
      const kind = kindRaw && (CONTACT_KINDS as readonly string[]).includes(kindRaw)
        ? kindRaw as (typeof CONTACT_KINDS)[number]
        : undefined;
      const sensitivityRaw = c.req.query("sensitivity");
      const sensitivity = sensitivityRaw && (CONTACT_SENSITIVITIES as readonly string[]).includes(sensitivityRaw)
        ? sensitivityRaw as (typeof CONTACT_SENSITIVITIES)[number]
        : undefined;
      // Pagination is opt-in: only a present `page` param switches the list
      // into paginated mode; `parsePageQuery` supplies the clamped values.
      const paginate = c.req.query("page") !== undefined;
      const { page, limit } = parsePageQuery(c, { limit: 20 });

      const result = await contactService.list(c.get("db"), actorOf(c), {
        ...(kind ? { kind } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {}),
        ...(categoryId ? { categoryId } : {}),
        q,
        status,
        sensitivity,
        ...(paginate ? { page, limit } : {}),
      });
      return c.json({
        success: true,
        data: result.data,
        meta: paginate
          ? { total: result.total, page, limit }
          : { total: result.total, page: 1, limit: result.total },
      });
    },
  );

  router.post(
    "/contacts",
    describeRoute({
      tags: ["contacts"],
      summary: "Create a contact",
      responses: {
        201: okJson(contactViewSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("json", contactBodySchema, onValidationFailure),
    async (c) => {
      const body = c.req.valid("json");
      const data = await contactService.create(c.get("db"), actorOf(c), body);
      await auditFromCtx(c, {
        action: "contact.created",
        resourceType: "contact",
        resourceId: data.id,
        resourceName: data.name,
        result: "success",
      });
      return c.json({ success: true, data }, 201);
    },
  );

  router.get(
    "/contacts/:id",
    describeRoute({
      tags: ["contacts"],
      summary: "Get a contact",
      responses: {
        200: okJson(contactViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = await contactService.get(c.get("db"), actorOf(c), id);
      return c.json({ success: true, data });
    },
  );

  router.patch(
    "/contacts/:id",
    describeRoute({
      tags: ["contacts"],
      summary: "Update a contact",
      responses: {
        200: okJson(contactViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateBodySchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const data = await contactService.update(c.get("db"), actorOf(c), id, body);
      await auditFromCtx(c, {
        action: "contact.updated",
        resourceType: "contact",
        resourceId: data.id,
        resourceName: data.name,
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/contacts/:id",
    describeRoute({
      tags: ["contacts"],
      summary: "Delete a contact",
      responses: {
        200: okJson(z.object({ id: z.string() })),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await contactService.delete(c.get("db"), actorOf(c), id, c.get("config"));
      await auditFromCtx(c, {
        action: "contact.deleted",
        resourceType: "contact",
        resourceId: id,
        resourceName: id,
        result: "success",
      });
      return c.json({ success: true, data: { id } });
    },
  );

  // POST /contacts/:id/avatar — set / replace the avatar/logo (contact update).
  router.post(
    "/contacts/:id/avatar",
    describeRoute({
      tags: ["contacts"],
      summary: "Set a contact avatar/logo",
      requestBody: {
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } },
      },
      responses: {
        200: okJson(contactViewSchema),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File))
        throw new AppError("No file provided", 400, "VALIDATION_ERROR");

      const data = await contactService.setAvatar(c.get("db"), actorOf(c), id, file, c.get("config"));
      await auditFromCtx(c, {
        action: "contact.avatar_set",
        resourceType: "contact",
        resourceId: id,
        resourceName: data.name,
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  // DELETE /contacts/:id/avatar — remove the avatar/logo (contact update).
  router.delete(
    "/contacts/:id/avatar",
    describeRoute({
      tags: ["contacts"],
      summary: "Remove a contact avatar/logo",
      responses: {
        200: okJson(contactViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = await contactService.removeAvatar(c.get("db"), actorOf(c), id, c.get("config"));
      await auditFromCtx(c, {
        action: "contact.avatar_removed",
        resourceType: "contact",
        resourceId: id,
        resourceName: data.name,
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/contacts/:id/grant",
    describeRoute({
      tags: ["contacts"],
      summary: "Grant contact access to a user or group",
      responses: {
        200: okJson(z.object({ id: z.string(), target: z.object({ type: z.enum(["user", "group"]), id: z.string() }) })),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", grantTargetSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const target = grantTarget(body);
      await contactService.grant(c.get("db"), actorOf(c), id, target);
      await auditFromCtx(c, {
        action: "contact.access_granted",
        resourceType: "contact",
        resourceId: id,
        resourceName: id,
        detail: { type: target.type, id: target.id },
        result: "success",
      });
      return c.json({ success: true, data: { id, target } });
    },
  );

  router.post(
    "/contacts/:id/revoke",
    describeRoute({
      tags: ["contacts"],
      summary: "Revoke contact access from a user or group",
      responses: {
        200: okJson(z.object({ id: z.string(), target: z.object({ type: z.enum(["user", "group"]), id: z.string() }), revoked: z.boolean() })),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", grantTargetSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const target = grantTarget(body);
      const revoked = await contactService.revoke(c.get("db"), actorOf(c), id, target);
      await auditFromCtx(c, {
        action: "contact.access_revoked",
        resourceType: "contact",
        resourceId: id,
        resourceName: id,
        detail: { ...target, revoked },
        result: "success",
      });
      return c.json({ success: true, data: { id, target, revoked } });
    },
  );

  return router;
}
