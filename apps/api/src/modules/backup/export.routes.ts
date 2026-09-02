import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, errorJson, resolver } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { getDataModules, getModuleNames } from "./registry";

/**
 * Module catalogue for the backup UI. The v1 JSON export routes that used
 * to live here (`POST /backup/export`, `POST /backup/export-via-token`)
 * were retired in FIX-072 — the v2 job routes in `export-v2.routes.ts` /
 * `export-v2-token.routes.ts` are the only export surface.
 */
export function backupExportRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  router.get(
    "/backup/modules",
    describeRoute({
      tags: ["infra2"],
      summary: "List exportable data modules and their dependencies",
      responses: {
        200: { description: "Success", content: { "application/json": { schema: resolver(z.object({
          modules: z.array(z.object({ name: z.string(), deps: z.array(z.string()) })),
        })) } } },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    (c) => {
      const registry = getDataModules();
      return c.json({
        modules: getModuleNames().map(name => ({
          name,
          deps: registry[name]!.deps,
        })),
      });
    },
  );

  return router;
}
