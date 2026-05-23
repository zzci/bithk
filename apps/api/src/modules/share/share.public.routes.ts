import type { Context } from "hono";
import type { ShareResourceType } from "./schema";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { buildDownloadResponse } from "@/modules/file";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError } from "@/shared/lib/errors";
import { findShareAdapter } from "./adapter";
import { gatePublicShare, getPublicShareMeta, reserveDownload, toGateRow } from "./share.service";

const accessSchema = z.object({ password: z.string().optional(), childId: z.string().optional() });
const listSchema = z.object({ password: z.string().optional(), parentId: z.string().optional() });

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

  router.get("/shared/:token", async (c) => {
    const data = await getPublicShareMeta(c.get("db"), c.req.param("token"));
    return c.json({ success: true, data });
  });

  router.post("/shared/:token", async (c) => {
    const token = c.req.param("token");
    const body = accessSchema.parse(await c.req.json().catch(() => ({})));
    const share = await gatePublicShare(c.get("db"), token, body.password);
    const adapter = requireAdapter(share.resourceType);
    if (!adapter.getContent)
      throw new AppError("Resource does not support content access", 400, "UNSUPPORTED");
    const data = await adapter.getContent(c.get("db"), toGateRow(share), body.childId);

    await audit(c.get("db"), c.get("logger"), {
      actorId: "client:public",
      actorName: "client:public",
      action: "share.accessed",
      resourceType: "share",
      resourceId: token,
      resourceName: share.resourceId,
      detail: { resourceType: share.resourceType, kind: "content" },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });

    return c.json({ success: true, data });
  });

  router.post("/shared/:token/list", async (c) => {
    const token = c.req.param("token");
    const body = listSchema.parse(await c.req.json().catch(() => ({})));
    const share = await gatePublicShare(c.get("db"), token, body.password);
    const adapter = requireAdapter(share.resourceType);
    if (!adapter.listChildren)
      throw new AppError("Resource does not support folder listing", 400, "UNSUPPORTED");
    const data = await adapter.listChildren(c.get("db"), toGateRow(share), body.parentId);
    return c.json({ success: true, data });
  });

  async function download(c: Context<AppEnv>, childId: string | undefined) {
    const token = c.req.param("token")!;
    const body = accessSchema.parse(await c.req.json().catch(() => ({})));
    const share = await gatePublicShare(c.get("db"), token, body.password);
    const adapter = requireAdapter(share.resourceType);
    if (!adapter.openFile)
      throw new AppError("Resource does not support downloads", 400, "UNSUPPORTED");

    // Validate eligibility (existence / subtree / permission) before reserving
    // the budget, so a forbidden request never consumes a download.
    const content = await adapter.openFile(c.get("db"), toGateRow(share), childId);
    if (!reserveDownload(c.get("db"), share.id))
      throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");

    await audit(c.get("db"), c.get("logger"), {
      actorId: "client:public",
      actorName: "client:public",
      action: "share.accessed",
      resourceType: "share",
      resourceId: token,
      resourceName: content.reference.filename,
      detail: { resourceType: share.resourceType, kind: "download", childId },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });

    return buildDownloadResponse(c.get("config"), content.file, content.reference, { inline: false });
  }

  router.post("/shared/:token/download", c => download(c, undefined));
  router.post("/shared/:token/download/:childId", c => download(c, c.req.param("childId")));

  return router;
}
