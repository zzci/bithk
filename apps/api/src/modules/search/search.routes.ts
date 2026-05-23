import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { authRequired } from "@/shared/middleware/auth";
import { globalSearch } from "./search.service";

export function searchRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  router.get("/search", async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const q = c.req.query("q") ?? "";
    const limit = Math.min(20, Math.max(1, Math.floor(Number.parseInt(c.req.query("limit") ?? "", 10)) || 8));

    const result = await globalSearch(db, {
      userId: user.id,
      isAdmin: user.role === "admin",
      q,
      limit,
    });

    return c.json({ success: true, data: result });
  });

  return router;
}
