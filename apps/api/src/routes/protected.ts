import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { accountRoutes } from "@/modules/account";
import { moduleGate } from "@/modules/account/groups/module-gate";
import { auditRoutes } from "@/modules/audit";
import { backupRoutes } from "@/modules/backup";
import { contactRoutes } from "@/modules/contact";
import { cronRoutes } from "@/modules/cron";
import { currencyRoutes } from "@/modules/currency";
import { documentRoutes } from "@/modules/document";
import { driveRoutes } from "@/modules/drive";
import { fileRoutes, storageRoutes } from "@/modules/file";
// Importing `hrRoutes` also registers the hr backup contribution.
import { hrRoutes } from "@/modules/hr";
import { issueRoutes } from "@/modules/issue";
import { issueTagBinding } from "@/modules/issue/issue.service";
// Importing `itemRoutes` also runs the `item` module's load-time side effects
// (backup contribution + the `item_attachment` file permission hooks).
import { itemRoutes } from "@/modules/item";
import { overviewRoutes } from "@/modules/overview";
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
import { apiTokenScopeGuard } from "@/shared/middleware/api-token-scope";

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

  // Module visibility gate (PLAN-076): must be registered before any module
  // router so hidden-module paths 404 before reaching a handler.
  app.use("*", moduleGate());
  // Personal Access Token scope ceiling (FEAT-034): after the module gate so
  // nav-module concealment (404) wins over scope rejection (403); a no-op for
  // cookie / anonymous requests.
  app.use("*", apiTokenScopeGuard());

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
  app.route("/", overviewRoutes());
  app.route("/", searchRoutes());
  app.route("/", shareRoutes());
  app.route("/", shipRoutes());
  app.route("/", worklistRoutes()); // global worklist KB (admin only)
  app.route("/", hrRoutes());
  app.route("/", settingsRoutes());
  app.route("/", currencyRoutes());
  app.route("/", auditRoutes());
  app.route("/", backupRoutes());
  app.route("/", cronRoutes());
  app.route("/", fileRoutes());
  app.route("/", storageRoutes());

  return app;
}
