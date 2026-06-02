import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError } from "@/shared/lib/errors";
import { requireParam } from "@/shared/lib/route-params";
import { authRequired } from "@/shared/middleware/auth";
import { findShareAdapter } from "./adapter";
import { SHARE_PERMISSIONS, SHARE_RESOURCE_TYPES } from "./schema";
import {
  createShare,
  listLinkShares,
  listReceivedShares,
  listSentShares,
  listSharesForResource,
  revokeShare,
  updateShare,
} from "./share.service";

const resourceTypeSchema = z.enum(SHARE_RESOURCE_TYPES);
const permissionSchema = z.enum(SHARE_PERMISSIONS);
// Expiry must be a real ISO-8601 datetime. A free-form string would slip past
// validation and then parse to `NaN`, making `isExpired` silently return
// false — an "expiring" link that never expires. Reject it at the boundary.
const expiresAtSchema = z.iso.datetime();

const createShareSchema = z.discriminatedUnion("shareType", [
  z.object({
    shareType: z.literal("direct"),
    sharedWithUserId: z.string().min(1),
    permission: permissionSchema,
  }),
  z.object({
    shareType: z.literal("public_link"),
    permission: permissionSchema.default("view"),
    password: z.string().min(1).max(128).optional(),
    expiresAt: expiresAtSchema.nullable().optional(),
    maxDownloads: z.number().int().positive().optional(),
  }),
]);

const updateShareSchema = z.object({
  permission: permissionSchema.optional(),
  password: z.string().min(1).max(128).nullable().optional(),
  expiresAt: expiresAtSchema.nullable().optional(),
  maxDownloads: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
}).refine(
  v => v.permission !== undefined || v.password !== undefined || v.expiresAt !== undefined || v.maxDownloads !== undefined || v.isActive !== undefined,
  { message: "At least one field must be provided" },
);

function auditMeta(c: Context<AppEnv>) {
  return { ip: getClientIp(c), userAgent: c.req.header("user-agent") ?? "unknown" };
}

function requireAdapter(resourceType: typeof SHARE_RESOURCE_TYPES[number]) {
  const adapter = findShareAdapter(resourceType);
  if (!adapter)
    throw new AppError(`No share adapter for resource type '${resourceType}'`, 400, "INVALID_RESOURCE_TYPE");
  return adapter;
}

/**
 * Authenticated share management. Mounted in `routes/protected.ts`.
 *
 * Resource-scoped create / list authorize through the resource adapter
 * (`authorizeManage`); update / revoke are ownership-based (only the share
 * creator); inboxes are user-scoped. Anonymous token access lives in
 * `share.public.routes.ts`.
 */
export function shareRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // Capabilities — drive UI rendering generically per resource type.
  router.get("/shares/capabilities/:type", async (c) => {
    const type = resourceTypeSchema.parse(c.req.param("type"));
    const adapter = requireAdapter(type);
    return c.json({ success: true, data: adapter.capabilities });
  });

  // Inboxes / outboxes (static paths before :id).
  router.get("/shares/received", async (c) => {
    const user = c.get("user")!;
    return c.json({ success: true, data: await listReceivedShares(c.get("db"), user.id) });
  });

  router.get("/shares/sent", async (c) => {
    const user = c.get("user")!;
    return c.json({ success: true, data: await listSentShares(c.get("db"), user.id) });
  });

  router.get("/shares/links", async (c) => {
    const user = c.get("user")!;
    return c.json({ success: true, data: await listLinkShares(c.get("db"), user.id) });
  });

  // Resource-scoped list + create.
  router.get("/shares/:type/:id", async (c) => {
    const type = resourceTypeSchema.parse(c.req.param("type"));
    const id = requireParam(c, "id");
    await requireAdapter(type).authorizeManage(c, id);
    return c.json({ success: true, data: await listSharesForResource(c.get("db"), type, id) });
  });

  router.post("/shares/:type/:id", async (c) => {
    const user = c.get("user")!;
    const type = resourceTypeSchema.parse(c.req.param("type"));
    const id = requireParam(c, "id");
    await requireAdapter(type).authorizeManage(c, id);
    const body = createShareSchema.parse(await c.req.json());
    const data = await createShare(c.get("db"), {
      resourceType: type,
      resourceId: id,
      createdBy: user.id,
      shareType: body.shareType,
      permission: body.permission,
      sharedWithUserId: body.shareType === "direct" ? body.sharedWithUserId : undefined,
      password: body.shareType === "public_link" ? body.password : undefined,
      expiresAt: body.shareType === "public_link" ? body.expiresAt : undefined,
      maxDownloads: body.shareType === "public_link" ? body.maxDownloads : undefined,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "share.created",
      resourceType: "share",
      resourceId: data.id,
      resourceName: data.resourceName,
      detail: { resourceType: type, shareType: data.shareType, permission: data.permission },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data }, 201);
  });

  // Ownership-based update / revoke (only the share creator).
  router.patch("/shares/:shareId", async (c) => {
    const user = c.get("user")!;
    const shareId = requireParam(c, "shareId");
    const body = updateShareSchema.parse(await c.req.json());
    const data = await updateShare(c.get("db"), shareId, user.id, body);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "share.updated",
      resourceType: "share",
      resourceId: data.id,
      resourceName: data.resourceName,
      detail: { isActive: data.isActive },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  router.delete("/shares/:shareId", async (c) => {
    const user = c.get("user")!;
    const shareId = requireParam(c, "shareId");
    await revokeShare(c.get("db"), shareId, user.id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "share.revoked",
      resourceType: "share",
      resourceId: shareId,
      resourceName: shareId,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id: shareId } });
  });

  return router;
}
