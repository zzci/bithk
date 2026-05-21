import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { accountRoutes } from "@/modules/account";
import { auditRoutes } from "@/modules/audit";
import { backupRoutes } from "@/modules/backup";
import { cronRoutes } from "@/modules/cron";
import { documentRoutes } from "@/modules/document";
import { driveRoutes } from "@/modules/drive";
import { fileRoutes } from "@/modules/file";
import { issueRoutes } from "@/modules/issue";
import { policyRoutes } from "@/modules/policy";
import { settingsRoutes } from "@/modules/settings";
// Side-effect import: the `item` module ships no HTTP routes; it registers
// its backup contribution and the `item_attachment` file permission hook at
// load time.
import "@/modules/item";

export function protectedRoutes() {
  const app = new Hono<AppEnv>();

  app.route("/", accountRoutes());
  app.route("/", issueRoutes());
  app.route("/", policyRoutes());
  app.route("/", documentRoutes());
  app.route("/", driveRoutes());
  app.route("/", settingsRoutes());
  app.route("/", auditRoutes());
  app.route("/", backupRoutes());
  app.route("/", cronRoutes());
  app.route("/", fileRoutes());

  return app;
}
