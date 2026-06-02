import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { ValidationError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import * as contactService from "./contact.service";
import { CONTACT_STATUSES, CONTACT_VISIBILITIES } from "./schema";

const idSchema = z.string().min(1);

const contactBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  contactPerson: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  taxId: z.string().trim().max(255).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  visibility: z.enum(CONTACT_VISIBILITIES).optional(),
  confidential: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).optional(),
});

const updateBodySchema = contactBodySchema.partial().refine(v => Object.keys(v).length > 0, {
  message: "At least one field must be provided",
});

const grantTargetSchema = z.object({
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
}).refine(v => (v.userId === undefined) !== (v.groupId === undefined), {
  message: "Provide exactly one of userId or groupId",
});

function actorOf(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return { id: user.id, role: user.role };
}

function auditMeta(c: Context<AppEnv>) {
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
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  router.get("/contacts", async (c) => {
    const tag = c.req.query("tag")?.trim();
    const qRaw = c.req.query("q")?.trim();
    const q = qRaw || undefined;
    const statusRaw = c.req.query("status");
    const status = statusRaw && (CONTACT_STATUSES as readonly string[]).includes(statusRaw)
      ? statusRaw as (typeof CONTACT_STATUSES)[number]
      : undefined;
    const visibilityRaw = c.req.query("visibility");
    const visibility = visibilityRaw && (CONTACT_VISIBILITIES as readonly string[]).includes(visibilityRaw)
      ? visibilityRaw as (typeof CONTACT_VISIBILITIES)[number]
      : undefined;
    const confidentialRaw = c.req.query("confidential");
    const confidential = confidentialRaw === "true"
      ? true
      : confidentialRaw === "false"
        ? false
        : undefined;
    const pageRaw = c.req.query("page");
    const paginate = pageRaw !== undefined;
    const page = paginate ? Math.max(1, Math.floor(Number.parseInt(pageRaw, 10)) || 1) : undefined;
    const limit = Math.min(100, Math.max(1, Math.floor(Number.parseInt(c.req.query("limit") ?? "", 10)) || 20));

    const result = await contactService.list(c.get("db"), actorOf(c), {
      ...(tag ? { tag } : {}),
      q,
      status,
      visibility,
      confidential,
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
    const user = c.get("user")!;
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
    const user = c.get("user")!;
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
    const user = c.get("user")!;
    const id = idSchema.parse(c.req.param("id"));
    await contactService.delete(c.get("db"), actorOf(c), id);
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

  router.post("/contacts/:id/grant", async (c) => {
    const user = c.get("user")!;
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
    const user = c.get("user")!;
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
