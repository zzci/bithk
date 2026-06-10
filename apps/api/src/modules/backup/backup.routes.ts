import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { backupBlobRestoreRoutes } from "./blob-restore.routes";
import { backupExportV2TokenRoutes } from "./export-v2-token.routes";
import { backupExportV2Routes } from "./export-v2.routes";
import { backupExportRoutes } from "./export.routes";
import { backupImportV2Routes } from "./import-v2.routes";
import { backupImportRoutes } from "./restore.routes";

export function backupRoutes() {
  const router = new Hono<AppEnv>();
  // Token routes mount FIRST: later routers register `use("*", authRequired)`
  // which would otherwise also run on the service-token paths.
  router.route("/", backupExportV2TokenRoutes());
  router.route("/", backupExportRoutes());
  router.route("/", backupExportV2Routes());
  router.route("/", backupImportV2Routes());
  router.route("/", backupBlobRestoreRoutes());
  router.route("/", backupImportRoutes());
  return router;
}
