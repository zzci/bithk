import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { backupExportV2Routes } from "./export-v2.routes";
import { backupExportRoutes } from "./export.routes";
import { backupImportRoutes } from "./restore.routes";

export function backupRoutes() {
  const router = new Hono<AppEnv>();
  router.route("/", backupExportRoutes());
  router.route("/", backupExportV2Routes());
  router.route("/", backupImportRoutes());
  return router;
}
