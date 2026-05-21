import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { buildDownloadResponse } from "@/modules/file";
import { getClientIp } from "@/shared/lib/client-ip";
import { accessPublicShare, getPublicShareMeta } from "./drive.share.service";

const accessShareSchema = z.object({ password: z.string().optional() });

/**
 * Unauthenticated public-link share access. Mounted in `routes/public.ts`
 * (no `authRequired`). Only `public_link` shares are reachable here; direct
 * shares resolve to 404 so they cannot be probed without a session.
 *
 *  - `GET  /drive/shared/:token` — metadata only (never bytes or password hash)
 *  - `POST /drive/shared/:token` — verify password, enforce expiry / quota,
 *    and stream a download for download/edit links (view-only returns meta).
 */
export function drivePublicRoutes() {
  const router = new Hono<AppEnv>();

  router.get("/drive/shared/:token", async (c) => {
    const token = c.req.param("token");
    const data = await getPublicShareMeta(c.get("db"), token);
    return c.json({ success: true, data });
  });

  router.post("/drive/shared/:token", async (c) => {
    const token = c.req.param("token");
    const body = accessShareSchema.parse(await c.req.json().catch(() => ({})));
    const result = await accessPublicShare(c.get("db"), token, body.password);

    await audit(c.get("db"), c.get("logger"), {
      actorId: "client:public",
      actorName: "client:public",
      action: "drive.share.accessed",
      resourceType: "drive_share",
      resourceId: token,
      resourceName: result.kind === "download" ? result.reference.filename : result.meta.filename,
      detail: { kind: result.kind },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });

    if (result.kind === "view")
      return c.json({ success: true, data: result.meta });

    return buildDownloadResponse(c.get("config"), result.file, result.reference, { inline: false });
  });

  return router;
}
