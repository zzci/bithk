import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { sharePublicRoutes } from "@/modules/share";
import { systemRoutes } from "@/modules/system";
import { apiTokenScopeGuard } from "@/shared/middleware/api-token-scope";

export function publicRoutes() {
  const app = new Hono<AppEnv>();

  // Personal Access Token scope ceiling (FEAT-034). Although these routers are
  // mounted as "public", systemRoutes carries `authRequired` endpoints (e.g.
  // GET /system/version, GET /system/upload-limits) that accept PAT bearers, so
  // the scope guard must run here too — otherwise a token could reach them
  // ignoring its `system` scope. No-op for cookie / anonymous / non-PAT requests.
  app.use("*", apiTokenScopeGuard());

  app.route("/", systemRoutes());
  app.route("/", sharePublicRoutes());

  return app;
}
