import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { documentPublicRoutes } from "@/modules/document";
import { drivePublicRoutes } from "@/modules/drive";
import { systemRoutes } from "@/modules/system";

export function publicRoutes() {
  const app = new Hono<AppEnv>();

  app.route("/", systemRoutes());
  app.route("/", drivePublicRoutes());
  app.route("/", documentPublicRoutes());

  return app;
}
