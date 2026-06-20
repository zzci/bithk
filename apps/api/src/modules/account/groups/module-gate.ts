import type { Context, MiddlewareHandler } from "hono";
import type { AppDatabase } from "@/db";
import type { AppEnv, RequestEnv } from "@/shared/lib/types";
import type { ModuleKey } from "@/shared/modules";
import { inArray } from "drizzle-orm";
import { listGroupIdsForUser } from "@/modules/policy/policy.service";
import { getSetting } from "@/modules/settings/settings.service";
import { NotFoundError } from "@/shared/lib/errors";
import { getAuthProvider } from "@/shared/middleware/auth-registry";
import { MODULE_KEYS, MODULES } from "@/shared/modules";
import { groups } from "./schema";

const MODULE_KEY_SET = new Set<string>(MODULE_KEYS);

/**
 * Settings key holding the built-in **Default** group's module grants (FEAT-043),
 * a JSON `string[]` of `MODULE_KEYS`. The Default group is the fallback for
 * users in no group: its modules are granted only to ungrouped non-admins.
 * Unset/empty keeps the historical zero-module visibility floor.
 */
export const DEFAULT_MODULES_SETTING_KEY = "account.default_modules";

/**
 * Resolve the Default group's modules (FEAT-043) in registry order. Granted to
 * a non-admin user only when they belong to no group; never unioned onto a
 * grouped user's set, so assigning a user to a (even grant-less) group tightens
 * them below the default. Unset → `[]`.
 */
export async function resolveDefaultModules(db: AppDatabase): Promise<ModuleKey[]> {
  const raw = await getSetting(db, DEFAULT_MODULES_SETTING_KEY);
  if (!raw)
    return [];
  const parsed = new Set(parseModules(raw));
  return MODULE_KEYS.filter(key => parsed.has(key));
}

/** Parse a stored JSON module list, dropping anything unknown. */
export function parseModules(raw: string): ModuleKey[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((m): m is ModuleKey => typeof m === "string" && MODULE_KEY_SET.has(m));
  }
  catch {
    return [];
  }
}

/**
 * Protected-router prefixes that are deliberately NOT gated by module
 * visibility. The route-coverage test asserts every prefix mounted on the
 * protected router is either claimed by exactly one `MODULES` entry or
 * listed here — so a new module cannot be mounted unmapped by accident.
 *
 * - `/account`, `/search`, `/tags`, `/policy`, `/settings`, `/currencies` —
 *   cross-cutting surfaces every authenticated user needs (search filters
 *   per-module inside its own handler).
 * - `/shares` — cross-cutting share management (decision in the registry).
 * - `/admin`, `/audit`, `/backup`, `/cron`, `/global-*`,
 *   `/contact-categories`, `/worklists` — admin-area groups that keep their
 *   existing `adminRequired` guards; not group-grantable in v1.
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
  "/currencies",
  "/files",
  "/global-equipment-categories",
  "/global-equipment-manufacturers",
  "/global-procurement-categories",
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
 * Resolve the module set a user may see (FEAT-032): admins get every
 * registered module; everyone else gets the UNION of the modules granted by
 * the groups they belong to. A user in no group falls back to the built-in
 * Default group's modules (FEAT-043) — the configurable visibility floor.
 */
export async function resolveUserModules(
  db: AppDatabase,
  user: { id: string; role: string },
): Promise<ModuleKey[]> {
  if (user.role === "admin")
    return [...MODULE_KEYS];

  const groupIds = await listGroupIdsForUser(db, user.id);
  // Ungrouped users fall back to the built-in Default group (FEAT-043); grouped
  // users get their groups' union only, so a restrictive group tightens access.
  if (groupIds.length === 0)
    return resolveDefaultModules(db);

  const rows = await db
    .select({ modules: groups.modules })
    .from(groups)
    .where(inArray(groups.id, [...groupIds]))
    .all();

  const union = new Set<ModuleKey>();
  for (const row of rows) {
    for (const key of parseModules(row.modules))
      union.add(key);
  }
  // Registry order keeps the result deterministic for `/account/me`.
  return MODULE_KEYS.filter(key => union.has(key));
}

/**
 * Resolve (and cache on the request context) the actor's visible module set.
 * At most one group lookup per request — the gate, `/account/me` and
 * `/search` all share the same cached value.
 */
export async function getRequestUserModules<E extends RequestEnv>(
  c: Context<E>,
  user: { id: string; role: string },
): Promise<readonly ModuleKey[]> {
  const cached = c.get("userModules");
  if (cached)
    return cached;
  const modules = await resolveUserModules(c.get("db"), user);
  c.set("userModules", modules);
  return modules;
}

/**
 * Module visibility gate (PLAN-076, group-based since FEAT-032). Mounted
 * first on the protected router: a request whose path is claimed by a module
 * the actor cannot see is answered with the same `NotFoundError` used for
 * nonexistent resources — fail-closed concealment per decision 003,
 * indistinguishable from a route that does not exist. Admins bypass without
 * any DB lookup. Unclaimed paths pass through untouched (their existing
 * guards still apply), and requests without a resolvable actor fall through
 * to each module's `authRequired` so unauthenticated callers keep today's
 * 401.
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
