import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, ErrorEnvelope, resolver } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { getCurrencyConfig } from "./currency.service";

const currencyConfigSchema = z.object({
  builtin: z.array(z.string()),
  custom: z.array(z.string()),
});

function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

// Currency list readable by ANY authenticated user (not admin-gated like the
// generic /settings CRUD), so the procurement and HR forms can offer the
// admin-managed list. Custom codes are written through PUT /settings/app.currencies.
export function currencyRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // GET /currencies — built-in + admin-configured custom currency codes
  router.get(
    "/currencies",
    describeRoute({
      tags: ["infra1"],
      summary: "List available currencies",
      responses: {
        200: okJson(currencyConfigSchema),
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    async (c) => {
      const data = await getCurrencyConfig(c.get("db"));
      return c.json({ success: true, data });
    },
  );

  return router;
}
