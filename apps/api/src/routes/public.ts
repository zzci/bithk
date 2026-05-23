import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { sharePublicRoutes } from "@/modules/share";
import { systemRoutes } from "@/modules/system";

export function publicRoutes() {
  const app = new Hono<AppEnv>();

  app.route("/", systemRoutes());
  app.route("/", sharePublicRoutes());

  return app;
}
