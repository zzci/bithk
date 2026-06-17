import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { findShareAdapter } from "./adapter";
import { SHARE_PERMISSIONS, SHARE_RESOURCE_TYPES, SHARE_TYPES } from "./schema";
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

// Path-param schemas — `type` reuses the resource-type enum so an unknown type
// is rejected at the boundary (422), matching the previous inline parse.
const typeParamSchema = z.object({ type: resourceTypeSchema });
const typeIdParamSchema = z.object({ type: resourceTypeSchema, id: z.string() });
const shareIdParamSchema = z.object({ shareId: z.string() });

// Response-doc schemas mirroring the service's `ShareView` / capabilities.
const shareFileSchema = z.object({ filename: z.string(), mimetype: z.string(), size: z.number() });
const shareViewSchema = z.object({
  id: z.string(),
  resourceType: resourceTypeSchema,
  resourceId: z.string(),
  resourceName: z.string(),
  isFolder: z.boolean(),
  token: z.string(),
  shareType: z.enum(SHARE_TYPES),
  sharedWithUserId: z.string().nullable(),
  permission: permissionSchema,
  hasPassword: z.boolean(),
  expiresAt: z.string().nullable(),
  maxDownloads: z.number().nullable(),
  downloadCount: z.number(),
  isActive: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  file: shareFileSchema.nullable(),
});
const capabilitiesSchema = z.object({
  shareTypes: z.array(z.enum(SHARE_TYPES)),
  permissions: z.array(permissionSchema),
});

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

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
  router.get(
    "/shares/capabilities/:type",
    describeRoute({
      tags: ["shares"],
      summary: "Get share capabilities for a resource type",
      responses: {
        200: okJson(capabilitiesSchema),
        401: { description: "Unauthenticated", ...errorJson },
        422: { description: "Unknown resource type", ...errorJson },
      },
    }),
    validator("param", typeParamSchema, onValidationFailure),
    async (c) => {
      const { type } = c.req.valid("param");
      const adapter = requireAdapter(type);
      return c.json({ success: true, data: adapter.capabilities });
    },
  );

  // Inboxes / outboxes (static paths before :id).
  router.get(
    "/shares/received",
    describeRoute({
      tags: ["shares"],
      summary: "List shares received by the caller",
      responses: { 200: okJson(z.array(shareViewSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user")!;
      return c.json({ success: true, data: await listReceivedShares(c.get("db"), user.id) });
    },
  );

  router.get(
    "/shares/sent",
    describeRoute({
      tags: ["shares"],
      summary: "List direct shares created by the caller",
      responses: { 200: okJson(z.array(shareViewSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user")!;
      return c.json({ success: true, data: await listSentShares(c.get("db"), user.id) });
    },
  );

  router.get(
    "/shares/links",
    describeRoute({
      tags: ["shares"],
      summary: "List public-link shares created by the caller",
      responses: { 200: okJson(z.array(shareViewSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user")!;
      return c.json({ success: true, data: await listLinkShares(c.get("db"), user.id) });
    },
  );

  // Resource-scoped list + create.
  router.get(
    "/shares/:type/:id",
    describeRoute({
      tags: ["shares"],
      summary: "List shares for a resource",
      responses: {
        200: okJson(z.array(shareViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Cannot manage this resource", ...errorJson },
        404: { description: "Resource not found", ...errorJson },
        422: { description: "Unknown resource type", ...errorJson },
      },
    }),
    validator("param", typeIdParamSchema, onValidationFailure),
    async (c) => {
      const { type, id } = c.req.valid("param");
      await requireAdapter(type).authorizeManage(c, id);
      return c.json({ success: true, data: await listSharesForResource(c.get("db"), type, id) });
    },
  );

  router.post(
    "/shares/:type/:id",
    describeRoute({
      tags: ["shares"],
      summary: "Create a share for a resource",
      responses: {
        201: okJson(shareViewSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Cannot manage this resource", ...errorJson },
        404: { description: "Resource not found", ...errorJson },
        409: { description: "Share already exists", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", typeIdParamSchema, onValidationFailure),
    validator("json", createShareSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user")!;
      const { type, id } = c.req.valid("param");
      await requireAdapter(type).authorizeManage(c, id);
      const body = c.req.valid("json");
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
    },
  );

  // Ownership-based update / revoke (only the share creator).
  router.patch(
    "/shares/:shareId",
    describeRoute({
      tags: ["shares"],
      summary: "Update a share",
      responses: {
        200: okJson(shareViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Not the share owner", ...errorJson },
        404: { description: "Share not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", shareIdParamSchema, onValidationFailure),
    validator("json", updateShareSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user")!;
      const { shareId } = c.req.valid("param");
      const body = c.req.valid("json");
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
    },
  );

  router.delete(
    "/shares/:shareId",
    describeRoute({
      tags: ["shares"],
      summary: "Revoke a share",
      responses: {
        200: okJson(z.object({ id: z.string() })),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Not the share owner", ...errorJson },
        404: { description: "Share not found", ...errorJson },
      },
    }),
    validator("param", shareIdParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user")!;
      const { shareId } = c.req.valid("param");
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
    },
  );

  return router;
}
