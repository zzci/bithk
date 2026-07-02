import type { Context } from "hono";
import type { ShareResourceType } from "./schema";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { buildDownloadResponse } from "@/modules/file";
import { AppError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { rateLimit } from "@/shared/middleware/rate-limit";
import { findShareAdapter } from "./adapter";
import { SHARE_PERMISSIONS, SHARE_RESOURCE_TYPES } from "./schema";
import { gatePublicShare, getPublicShareMeta, reserveDownload, toGateRow } from "./share.service";

const accessSchema = z.object({ password: z.string().optional(), childId: z.string().optional() });
const listSchema = z.object({ password: z.string().optional(), parentId: z.string().optional() });
const tokenParamSchema = z.object({ token: z.string() });
const tokenChildParamSchema = z.object({ token: z.string(), childId: z.string() });

// Response-doc schemas mirroring the service's public-facing shapes.
const publicShareMetaSchema = z.object({
  token: z.string(),
  resourceType: z.enum(SHARE_RESOURCE_TYPES),
  name: z.string(),
  isFolder: z.boolean(),
  permission: z.enum(SHARE_PERMISSIONS),
  requiresPassword: z.boolean(),
  expired: z.boolean(),
  exhausted: z.boolean(),
});
const publicShareEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["file", "folder"]),
  size: z.number().nullable(),
  mimetype: z.string().nullable(),
});
const publicShareListingSchema = z.object({
  breadcrumb: z.array(z.object({ id: z.string(), name: z.string() })),
  entries: z.array(publicShareEntrySchema),
});

function requireAdapter(resourceType: ShareResourceType) {
  const adapter = findShareAdapter(resourceType);
  if (!adapter)
    throw new AppError(`No share adapter for resource type '${resourceType}'`, 400, "INVALID_RESOURCE_TYPE");
  return adapter;
}

/**
 * Unauthenticated public-link share access. Mounted in `routes/public.ts`
 * (no `authRequired`). Only `public_link` shares are reachable; direct shares
 * resolve to 404 so they cannot be probed without a session.
 *
 * The share module owns the token gate (password / expiry / exhaustion); the
 * resource adapter renders content (`getContent`), lists folders
 * (`listChildren`), and streams files (`openFile`).
 *
 *  - `GET  /shared/:token`                 — gate metadata (never bytes / hash)
 *  - `POST /shared/:token`                 — verify password, return resource content
 *  - `POST /shared/:token/list`            — browse a folder-like share
 *  - `POST /shared/:token/download[/:childId]` — stream a file (budget-counted)
 */
export function sharePublicRoutes() {
  const router = new Hono<AppEnv>();

  // These endpoints are unauthenticated, so without a gate a password-
  // protected share token can be brute-forced and download budgets probed at
  // network speed. Apply an IP-keyed limiter across every public share path,
  // mirroring the 120/min window the public auth routes use (comfortably above
  // human browsing throughput, far below brute-force throughput).
  //
  // Scope to `/shared/*` — NOT `*`. Hono flattens a sub-app's middleware onto
  // the parent at mount time, and a bare `*` here would attach to every route
  // registered after this router (all of `protectedRoutes`, including
  // `/account/auth/login`), making them share the "share-public" bucket. The
  // path scope keys the limiter to share endpoints only.
  router.use("/shared/*", rateLimit({ windowMs: 60_000, max: 120, bucket: "share-public" }));

  router.get(
    "/shared/:token",
    describeRoute({
      tags: ["shares"],
      summary: "Get public share metadata",
      responses: {
        200: okJson(publicShareMetaSchema),
        404: { description: "Share link not found", ...errorJson },
      },
    }),
    validator("param", tokenParamSchema, onValidationFailure),
    async (c) => {
      const { token } = c.req.valid("param");
      const data = await getPublicShareMeta(c.get("db"), token);
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/shared/:token",
    describeRoute({
      tags: ["shares"],
      summary: "Access public share content",
      responses: {
        200: okJson(z.unknown()),
        400: { description: "Resource does not support content access", ...errorJson },
        403: { description: "Password required or invalid", ...errorJson },
        404: { description: "Share link not found", ...errorJson },
        410: { description: "Share link expired or exhausted", ...errorJson },
      },
    }),
    validator("param", tokenParamSchema, onValidationFailure),
    validator("json", accessSchema, onValidationFailure),
    async (c) => {
      const { token } = c.req.valid("param");
      const body = c.req.valid("json");
      const share = await gatePublicShare(c.get("db"), token, body.password);
      const adapter = requireAdapter(share.resourceType);
      if (!adapter.getContent)
        throw new AppError("Resource does not support content access", 400, "UNSUPPORTED");
      const data = await adapter.getContent(c.get("db"), toGateRow(share), body.childId);

      await auditFromCtx(c, {
        actorId: "client:public",
        actorName: "client:public",
        action: "share.accessed",
        resourceType: "share",
        resourceId: token,
        resourceName: share.resourceId,
        detail: { resourceType: share.resourceType, kind: "content" },
        result: "success",
      });

      return c.json({ success: true, data });
    },
  );

  router.post(
    "/shared/:token/list",
    describeRoute({
      tags: ["shares"],
      summary: "List entries inside a public folder share",
      responses: {
        200: okJson(publicShareListingSchema),
        400: { description: "Resource does not support folder listing", ...errorJson },
        403: { description: "Password required or invalid", ...errorJson },
        404: { description: "Share link not found", ...errorJson },
        410: { description: "Share link expired or exhausted", ...errorJson },
      },
    }),
    validator("param", tokenParamSchema, onValidationFailure),
    validator("json", listSchema, onValidationFailure),
    async (c) => {
      const { token } = c.req.valid("param");
      const body = c.req.valid("json");
      const share = await gatePublicShare(c.get("db"), token, body.password);
      const adapter = requireAdapter(share.resourceType);
      if (!adapter.listChildren)
        throw new AppError("Resource does not support folder listing", 400, "UNSUPPORTED");
      const data = await adapter.listChildren(c.get("db"), toGateRow(share), body.parentId);
      return c.json({ success: true, data });
    },
  );

  async function download(
    c: Context<AppEnv>,
    token: string,
    password: string | undefined,
    childId: string | undefined,
  ) {
    const share = await gatePublicShare(c.get("db"), token, password);
    const adapter = requireAdapter(share.resourceType);
    if (!adapter.openFile)
      throw new AppError("Resource does not support downloads", 400, "UNSUPPORTED");

    // Validate eligibility (existence / subtree / permission) before reserving
    // the budget, so a forbidden request never consumes a download.
    const content = await adapter.openFile(c.get("db"), toGateRow(share), childId);
    if (!reserveDownload(c.get("db"), share.id))
      throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");

    await auditFromCtx(c, {
      actorId: "client:public",
      actorName: "client:public",
      action: "share.accessed",
      resourceType: "share",
      resourceId: token,
      resourceName: content.reference.filename,
      detail: { resourceType: share.resourceType, kind: "download", childId },
      result: "success",
    });

    return buildDownloadResponse(c.get("config"), content.file, content.reference, { inline: false });
  }

  const downloadResponses = {
    200: { description: "File stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
    400: { description: "Resource does not support downloads", ...errorJson },
    403: { description: "Password required or invalid", ...errorJson },
    404: { description: "Share link or file not found", ...errorJson },
    410: { description: "Share link expired or download limit reached", ...errorJson },
  } as const;

  router.post(
    "/shared/:token/download",
    describeRoute({ tags: ["shares"], summary: "Download a public share file", responses: downloadResponses }),
    validator("param", tokenParamSchema, onValidationFailure),
    validator("json", accessSchema, onValidationFailure),
    c => download(c, c.req.valid("param").token, c.req.valid("json").password, undefined),
  );
  router.post(
    "/shared/:token/download/:childId",
    describeRoute({ tags: ["shares"], summary: "Download a child of a public share", responses: downloadResponses }),
    validator("param", tokenChildParamSchema, onValidationFailure),
    validator("json", accessSchema, onValidationFailure),
    c => download(c, c.req.valid("param").token, c.req.valid("json").password, c.req.valid("param").childId),
  );

  return router;
}
