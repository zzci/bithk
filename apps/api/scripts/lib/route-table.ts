// Shared in-process route enumeration. Mounts every module's `*.routes`
// factory into a bare Hono app and reads the routes table — no live server,
// no DB. Used by `gen-api-docs.ts` (route index) and `gen-api-spec.ts`
// (OpenAPI coverage), so both stay in lockstep with the real mounts.
import { Hono } from "hono";
import { accountRoutes } from "@/modules/account";
import { auditRoutes } from "@/modules/audit";
import { backupRoutes } from "@/modules/backup";
import { contactRoutes } from "@/modules/contact";
import { cronRoutes } from "@/modules/cron";
import { documentRoutes } from "@/modules/document";
import { driveRoutes } from "@/modules/drive";
import { fileRoutes } from "@/modules/file";
import { hrRoutes } from "@/modules/hr";
import { issueRoutes } from "@/modules/issue";
import { itemRoutes } from "@/modules/item";
import { policyRoutes } from "@/modules/policy";
import { procurementRoutes } from "@/modules/procurement";
import { projectRoutes } from "@/modules/project";
import { searchRoutes } from "@/modules/search";
import { settingsRoutes } from "@/modules/settings";
import { sharePublicRoutes, shareRoutes } from "@/modules/share";
import { shipRoutes } from "@/modules/ship";
import { worklistRoutes } from "@/modules/ship/ship.worklist.service";
import { systemRoutes } from "@/modules/system";
import { tagRoutes } from "@/modules/tag";

export interface ApiRoute {
  readonly method: string;
  /** Raw mounted path with Hono `:param` segments and NO `/api` prefix. */
  readonly path: string;
}

const SKIP_METHODS = new Set(["ALL", "HEAD", "OPTIONS"]);

/**
 * Every concrete API route (method + raw path), deduped and sorted. Wildcard
 * middleware mounts (`/*`) and non-routable methods are dropped. The `/api`
 * prefix is NOT included — callers add it where needed.
 */
export function collectApiRoutes(): ApiRoute[] {
  const app = new Hono();
  app.route("/", systemRoutes());
  app.route("/", sharePublicRoutes());
  app.route("/", accountRoutes());
  app.route("/", issueRoutes());
  app.route("/", itemRoutes());
  app.route("/", policyRoutes());
  app.route("/", projectRoutes());
  app.route("/", contactRoutes());
  app.route("/", tagRoutes());
  app.route("/", procurementRoutes());
  app.route("/", documentRoutes());
  app.route("/", driveRoutes());
  app.route("/", shareRoutes());
  app.route("/", shipRoutes());
  app.route("/", searchRoutes());
  app.route("/", worklistRoutes());
  app.route("/", hrRoutes());
  app.route("/", settingsRoutes());
  app.route("/", auditRoutes());
  app.route("/", backupRoutes());
  app.route("/", cronRoutes());
  app.route("/", fileRoutes());

  const table = (app as unknown as { routes: ApiRoute[] }).routes;
  const seen = new Set<string>();
  const out: ApiRoute[] = [];
  for (const r of table) {
    if (SKIP_METHODS.has(r.method))
      continue;
    if (r.path === "/*" || r.path.endsWith("/*"))
      continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push({ method: r.method, path: r.path });
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return out;
}
