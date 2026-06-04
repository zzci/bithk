import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, NotFoundError, ValidationError } from "@/shared/lib/errors";
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
import { CONTACT_KINDS, CONTACT_STATUSES, CONTACT_VISIBILITIES } from "./schema";

const idSchema = z.string().min(1);

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

// Free-form extra fields: a flat map of string keys (≤200) to string values
// (≤2000), capped at 50 keys. Nested objects / arrays are rejected by z.record.
const attributesSchema = z
  .record(z.string().max(200), z.string().max(2000))
  .refine(v => Object.keys(v).length <= 50, { message: "At most 50 attribute keys allowed" })
  .nullable()
  .optional();

// Fields shared by both kinds.
const commonContactFields = {
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(255).nullable().optional(),
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
  email: z.string().trim().email().max(255).nullable().optional(),
  position: z.string().trim().max(255).nullable().optional(),
  organizationId: z.string().trim().min(1).nullable().optional(),
  organizationName: z.string().trim().max(255).nullable().optional(),
  ...commonContactFields,
});

const organizationBodySchema = z.object({
  kind: z.literal("organization"),
  taxId: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  ...commonContactFields,
});

const contactBodySchema = z.discriminatedUnion("kind", [individualBodySchema, organizationBodySchema]);

// `kind` is immutable, so the update body omits it; the service validates the
// provided fields against the stored kind. Accepts the union of both kinds'
// fields, all optional.
const updateBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  position: z.string().trim().max(255).nullable().optional(),
  organizationId: z.string().trim().min(1).nullable().optional(),
  organizationName: z.string().trim().max(255).nullable().optional(),
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

function actorOf(c: Context<ProtectedEnv>) {
  const user = c.get("user");
  return { id: user.id, role: user.role };
}

function auditMeta(c: Context<ProtectedEnv>) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
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
  router.get("/contact-categories", adminRequired, async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: (await listContactCategories(db)).map(composeContactCategory) });
  });

  router.post("/contact-categories", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = createContactCategorySchema.parse(await c.req.json());
    const category = await createContactCategory(db, body);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact_category.created",
      resourceType: "contact_category",
      resourceId: category.id,
      resourceName: category.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: composeContactCategory(category) }, 201);
  });

  router.patch("/contact-categories/:id", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const body = updateContactCategorySchema.parse(await c.req.json());
    const category = await updateContactCategory(db, id, body);
    if (!category)
      throw new NotFoundError("Contact category", id);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact_category.updated",
      resourceType: "contact_category",
      resourceId: category.id,
      resourceName: category.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: composeContactCategory(category) });
  });

  router.delete("/contact-categories/:id", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const category = await resolveContactCategory(db, id);
    if (!category || !await deleteContactCategory(db, id))
      throw new NotFoundError("Contact category", id);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact_category.deleted",
      resourceType: "contact_category",
      resourceId: category.id,
      resourceName: category.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  router.get("/contacts", async (c) => {
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
    const pageRaw = c.req.query("page");
    const paginate = pageRaw !== undefined;
    const page = paginate ? Math.max(1, Math.floor(Number.parseInt(pageRaw, 10)) || 1) : undefined;
    const limit = Math.min(100, Math.max(1, Math.floor(Number.parseInt(c.req.query("limit") ?? "", 10)) || 20));

    const result = await contactService.list(c.get("db"), actorOf(c), {
      ...(kind ? { kind } : {}),
      ...(tagIds.length > 0 ? { tagIds } : {}),
      ...(categoryId ? { categoryId } : {}),
      q,
      status,
      ...(paginate ? { page, limit } : {}),
    });
    return c.json({
      success: true,
      data: result.data,
      meta: paginate
        ? { total: result.total, page: page!, limit }
        : { total: result.total, page: 1, limit: result.total },
    });
  });

  router.post("/contacts", async (c) => {
    const user = c.get("user");
    const body = contactBodySchema.parse(await c.req.json());
    const data = await contactService.create(c.get("db"), actorOf(c), body);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.created",
      resourceType: "contact",
      resourceId: data.id,
      resourceName: data.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data }, 201);
  });

  router.get("/contacts/:id", async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const data = await contactService.get(c.get("db"), actorOf(c), id);
    return c.json({ success: true, data });
  });

  router.patch("/contacts/:id", async (c) => {
    const user = c.get("user");
    const id = idSchema.parse(c.req.param("id"));
    const body = updateBodySchema.parse(await c.req.json());
    const data = await contactService.update(c.get("db"), actorOf(c), id, body);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.updated",
      resourceType: "contact",
      resourceId: data.id,
      resourceName: data.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  router.delete("/contacts/:id", async (c) => {
    const user = c.get("user");
    const id = idSchema.parse(c.req.param("id"));
    await contactService.delete(c.get("db"), actorOf(c), id, c.get("config"));
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.deleted",
      resourceType: "contact",
      resourceId: id,
      resourceName: id,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id } });
  });

  // POST /contacts/:id/avatar — set / replace the avatar/logo (contact update).
  router.post("/contacts/:id/avatar", async (c) => {
    const user = c.get("user");
    const id = idSchema.parse(c.req.param("id"));

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new AppError("No file provided", 400, "VALIDATION_ERROR");
    if (!file.type.startsWith("image/"))
      throw new AppError("Avatar must be an image file", 400, "INVALID_MIMETYPE");

    const data = await contactService.setAvatar(c.get("db"), actorOf(c), id, file, c.get("config"));
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.avatar_set",
      resourceType: "contact",
      resourceId: id,
      resourceName: data.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  // DELETE /contacts/:id/avatar — remove the avatar/logo (contact update).
  router.delete("/contacts/:id/avatar", async (c) => {
    const user = c.get("user");
    const id = idSchema.parse(c.req.param("id"));
    const data = await contactService.removeAvatar(c.get("db"), actorOf(c), id, c.get("config"));
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.avatar_removed",
      resourceType: "contact",
      resourceId: id,
      resourceName: data.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  router.post("/contacts/:id/grant", async (c) => {
    const user = c.get("user");
    const id = idSchema.parse(c.req.param("id"));
    const body = grantTargetSchema.parse(await c.req.json());
    const target = grantTarget(body);
    await contactService.grant(c.get("db"), actorOf(c), id, target);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.access_granted",
      resourceType: "contact",
      resourceId: id,
      resourceName: id,
      detail: { type: target.type, id: target.id },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id, target } });
  });

  router.post("/contacts/:id/revoke", async (c) => {
    const user = c.get("user");
    const id = idSchema.parse(c.req.param("id"));
    const body = grantTargetSchema.parse(await c.req.json());
    const target = grantTarget(body);
    const revoked = await contactService.revoke(c.get("db"), actorOf(c), id, target);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "contact.access_revoked",
      resourceType: "contact",
      resourceId: id,
      resourceName: id,
      detail: { ...target, revoked },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id, target, revoked } });
  });

  return router;
}
