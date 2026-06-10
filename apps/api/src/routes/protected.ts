import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { accountRoutes } from "@/modules/account";
import { auditRoutes } from "@/modules/audit";
import { backupRoutes } from "@/modules/backup";
import { contactRoutes } from "@/modules/contact";
import { cronRoutes } from "@/modules/cron";
import { documentRoutes } from "@/modules/document";
import { driveRoutes } from "@/modules/drive";
import { fileRoutes } from "@/modules/file";
// Importing `financeRoutes` also registers the finance backup contribution.
import { financeRoutes } from "@/modules/finance";
import { issueRoutes } from "@/modules/issue";
import { issueTagBinding } from "@/modules/issue/issue.service";
// Importing `itemRoutes` also runs the `item` module's load-time side effects
// (backup contribution + the `item_attachment` file permission hooks).
import { itemRoutes } from "@/modules/item";
import { policyRoutes } from "@/modules/policy";
import { procurementRoutes } from "@/modules/procurement";
import { procurementTagBinding } from "@/modules/procurement/procurement.service";
import { projectRoutes } from "@/modules/project";
import { searchRoutes } from "@/modules/search";
import { settingsRoutes } from "@/modules/settings";
import { shareRoutes } from "@/modules/share";
import { shipRoutes } from "@/modules/ship";
import { worklistRoutes } from "@/modules/ship/ship.worklist.service";
// Importing the tag module registers the `tags` backup contribution and exposes
// `tagRoutes` (the shared typed-tag vocabulary). Each domain's `{ type }` binding
// is wired into the tag registry here so the module never imports a domain schema.
import { registerTagSource, tagRoutes } from "@/modules/tag";

// Register each domain's tag binding as a load-time side effect, so
// the shared `/tags` routes know which types exist at boot.
registerTagSource({ type: "project" });
registerTagSource({ type: "contact" });
registerTagSource({ type: "document" });
registerTagSource({ type: "worklist" });
registerTagSource(issueTagBinding);
registerTagSource(procurementTagBinding);

export function protectedRoutes() {
  const app = new Hono<AppEnv>();

  app.route("/", accountRoutes());
  app.route("/", tagRoutes());
  app.route("/", issueRoutes());
  app.route("/", itemRoutes());
  app.route("/", policyRoutes());
  app.route("/", projectRoutes());
  app.route("/", contactRoutes());
  app.route("/", procurementRoutes());
  app.route("/", documentRoutes());
  app.route("/", driveRoutes());
  app.route("/", searchRoutes());
  app.route("/", shareRoutes());
  app.route("/", shipRoutes());
  app.route("/", worklistRoutes()); // global worklist KB (admin only)
  app.route("/", financeRoutes());
  app.route("/", settingsRoutes());
  app.route("/", auditRoutes());
  app.route("/", backupRoutes());
  app.route("/", cronRoutes());
  app.route("/", fileRoutes());

  return app;
}
