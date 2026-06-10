import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, RequestEnv } from "@/shared/lib/types";
import type { ModuleKey } from "@/shared/modules";
import { NotFoundError } from "@/shared/lib/errors";
import { getAuthProvider } from "@/shared/middleware/auth-registry";
import { MODULES } from "@/shared/modules";
import { resolveUserModules } from "./roles.service";

/**
 * Protected-router prefixes that are deliberately NOT gated by module
 * visibility. The route-coverage test asserts every prefix mounted on the
 * protected router is either claimed by exactly one `MODULES` entry or
 * listed here — so a new module cannot be mounted unmapped by accident.
 *
 * - `/account`, `/search`, `/tags`, `/policy`, `/settings` — cross-cutting
 *   surfaces every authenticated user needs (search filters per-module
 *   inside its own handler).
 * - `/shares` — cross-cutting share management (decision in the registry).
 * - `/admin`, `/audit`, `/backup`, `/cron`, `/global-*`,
 *   `/contact-categories`, `/worklists` — admin-area groups that keep their
 *   existing `adminRequired` guards; not role-grantable in v1.
 * - `/files` — attachment infrastructure shared by several modules; every
 *   route enforces its own per-resource permission hooks.
 */
export const UNGATED_PREFIXES: readonly string[] = [
  "/account",
  "/admin",
  "/audit",
  "/backup",
  "/contact-categories",
  "/cron",
  "/files",
  "/global-equipment-categories",
  "/global-equipment-manufacturers",
  "/global-procurement-categories",
  "/global-roles",
  "/policy",
  "/search",
  "/settings",
  "/shares",
  "/tags",
  "/worklists",
];

/** Map a protected-router path to the module claiming it, if any. */
export function moduleForPath(path: string): ModuleKey | null {
  for (const m of MODULES) {
    for (const p of m.prefixes) {
      if (path === p || path.startsWith(`${p}/`))
        return m.key;
    }
  }
  return null;
}

/**
 * Resolve (and cache on the request context) the actor's visible module set.
 * At most one role lookup per request — the gate, `/account/me` and `/search`
 * all share the same cached value.
 */
export async function getRequestUserModules<E extends RequestEnv>(
  c: Context<E>,
  user: { role: string; globalRoleId: string | null },
): Promise<readonly ModuleKey[]> {
  const cached = c.get("userModules");
  if (cached)
    return cached;
  const modules = await resolveUserModules(c.get("db"), user);
  c.set("userModules", modules);
  return modules;
}

/**
 * Module visibility gate (PLAN-076). Mounted first on the protected router:
 * a request whose path is claimed by a module the actor cannot see is
 * answered with the same `NotFoundError` used for nonexistent resources —
 * fail-closed concealment per decision 003, indistinguishable from a route
 * that does not exist. Admins bypass without any DB lookup. Unclaimed paths
 * pass through untouched (their existing guards still apply), and requests
 * without a resolvable actor fall through to each module's `authRequired`
 * so unauthenticated callers keep today's 401.
 */
export function moduleGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // The protected router is mounted at `${BASE_PATH}/api`; strip that
    // prefix so registry prefixes (`/hr`, …) match (same compensation as
    // `policyMiddleware({ basePath })`).
    const base = `${c.get("config").BASE_PATH}/api`;
    const path = c.req.path.startsWith(`${base}/`) ? c.req.path.slice(base.length) : c.req.path;
    const moduleKey = moduleForPath(path);
    if (!moduleKey)
      return next();

    // Idempotent actor load, mirroring `policyMiddleware`: reuse the actor
    // when an upstream middleware already resolved it.
    let user = c.get("user");
    if (!user) {
      const loaded = await getAuthProvider()(c.get("db"), c);
      if (loaded) {
        c.set("user", loaded);
        user = loaded;
      }
    }
    if (!user)
      return next();
    if (user.role === "admin")
      return next();

    const allowed = await getRequestUserModules(c, user);
    if (!allowed.includes(moduleKey))
      throw new NotFoundError("Route");

    return next();
  };
}
