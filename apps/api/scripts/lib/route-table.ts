// Shared in-process route enumeration. Composes the REAL `publicRoutes()` /
// `protectedRoutes()` factories — the exact mounts `app.ts` serves — into a
// bare Hono app and reads the routes table; no live server, no DB. Used by
// `gen-api-docs.ts` (route index) and `gen-api-spec.ts` (OpenAPI coverage).
// A hand-copied mount list lived here before and drifted twice (FIX-045,
// then `/admin/storage/*` + `/currencies`); reusing the factories keeps the
// generated docs in lockstep with the app by construction (REFACTOR-030).
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { protectedRoutes, publicRoutes } from "@/routes";

export interface ApiRoute {
  readonly method: string;
  /** Raw mounted path with Hono `:param` segments and NO `/api` prefix. */
  readonly path: string;
}

const SKIP_METHODS = new Set(["ALL", "HEAD", "OPTIONS"]);

/**
 * A bare Hono app mounting the same route factories as `app.ts` (with their
 * `describeRoute` / `validator` OpenAPI metadata) — no DB, no server. The
 * `use("*")` middleware the factories register is inert here (routes are
 * enumerated, never dispatched) and is filtered out by `collectApiRoutes`.
 * Used by `gen-api-spec.ts` (via `generateSpecs`) and `collectApiRoutes`.
 */
export function buildApiApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route("/", publicRoutes());
  app.route("/", protectedRoutes());
  return app;
}

/**
 * Every concrete API route (method + raw path), deduped and sorted. Wildcard
 * middleware mounts (`/*`) and non-routable methods are dropped. The `/api`
 * prefix is NOT included — callers add it where needed.
 */
export function collectApiRoutes(): ApiRoute[] {
  const table = (buildApiApp() as unknown as { routes: ApiRoute[] }).routes;
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
