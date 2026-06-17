import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { getRequestUserModules } from "@/modules/account/groups/module-gate";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { globalSearch } from "./search.service";

// `q`/`limit` are documented as optional strings; the route keeps its lenient
// parsing (blank `q` ⇒ empty result, non-numeric `limit` ⇒ default) rather than
// rejecting, so validation never fails here.
const searchQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.string().optional(),
});

const searchHitSchema = z.object({
  type: z.enum(["document", "issue", "project", "drive", "ship"]),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  projectId: z.string().optional(),
});
const searchResultSchema = z.object({
  documents: z.array(searchHitSchema),
  issues: z.array(searchHitSchema),
  projects: z.array(searchHitSchema),
  drive: z.array(searchHitSchema),
  ships: z.array(searchHitSchema),
});

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

export function searchRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.get(
    "/search",
    describeRoute({
      tags: ["infra1"],
      summary: "Global search",
      responses: {
        200: okJson(searchResultSchema),
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    validator("query", searchQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { q: rawQ, limit: rawLimit } = c.req.valid("query");
      // Cap q length to avoid pathological LIKE scans (it only feeds parameterized
      // LIKE patterns, so this is a defensive bound rather than an injection guard).
      const q = (rawQ ?? "").slice(0, 256);
      const limit = Math.min(20, Math.max(1, Math.floor(Number.parseInt(rawLimit ?? "", 10)) || 8));

      // Restrict searched domains to the actor's visible modules (PLAN-076);
      // admins resolve to every module key.
      const modules = await getRequestUserModules(c, user);

      const result = await globalSearch(db, {
        userId: user.id,
        isAdmin: user.role === "admin",
        q,
        limit,
        modules,
      });

      return c.json({ success: true, data: result });
    },
  );

  return router;
}
