// Personal Access Token scope model (FEAT-034).
//
// A token carries a per-module access level — "read" (safe methods only),
// "write" (read + mutate), or none (key absent). The set of scope modules is a
// SUPERSET of the 6 nav modules in `@/shared/modules`: it must cover EVERY
// protected route so a token can be scoped down to any part of the API. The
// `tokens.scope.coverage.test.ts` enumerates the real mounted routes and
// asserts each one maps to exactly one module here — a new route cannot ship
// unmapped. The guard is independent of the policy engine: effective access is
// `owner policy permissions ∩ token scope`.

export type ScopeLevel = "read" | "write";

/** Opaque secret prefix; also the leak-scanner marker. */
export const TOKEN_SECRET_PREFIX = "bithk_pat_";

export function isApiTokenSecret(value: string): boolean {
  return value.startsWith(TOKEN_SECRET_PREFIX);
}

export interface TokenModuleDefinition {
  readonly key: string;
  readonly prefixes: readonly string[];
}

// Ordered registry; first match wins, exactly like `moduleForPath` in the
// nav-module gate. Prefixes are disjoint with ONE deliberate, ordered
// exception: `/admin/project-default-cover` (a project-domain setting that
// happens to be mounted under `/admin`) is claimed by `projects` above the
// `account` entry that owns the rest of `/admin`, so a project-scoped token —
// not an account-scoped one — governs it.
export const TOKEN_MODULES = [
  { key: "documents", prefixes: ["/documents", "/shared"] },
  { key: "drive", prefixes: ["/drive"] },
  { key: "files", prefixes: ["/files"] },
  { key: "projects", prefixes: ["/projects", "/issues", "/global-procurement-categories", "/admin/project-default-cover"] },
  { key: "ships", prefixes: ["/ships", "/worklists", "/global-equipment-categories", "/global-equipment-manufacturers"] },
  { key: "contacts", prefixes: ["/contacts", "/contact-categories"] },
  { key: "hr", prefixes: ["/hr"] },
  { key: "tags", prefixes: ["/tags"] },
  { key: "shares", prefixes: ["/shares"] },
  { key: "search", prefixes: ["/search"] },
  { key: "account", prefixes: ["/account", "/admin"] },
  { key: "settings", prefixes: ["/settings"] },
  { key: "policy", prefixes: ["/policy"] },
  { key: "audit", prefixes: ["/audit"] },
  { key: "backup", prefixes: ["/backup"] },
  { key: "cron", prefixes: ["/cron"] },
  { key: "system", prefixes: ["/system", "/health", "/metrics"] },
] as const satisfies readonly TokenModuleDefinition[];

export type TokenModuleKey = typeof TOKEN_MODULES[number]["key"];

export const TOKEN_MODULE_KEYS: readonly TokenModuleKey[] = TOKEN_MODULES.map(m => m.key);

const TOKEN_MODULE_KEY_SET = new Set<string>(TOKEN_MODULE_KEYS);

export type TokenScopeMap = Partial<Record<TokenModuleKey, ScopeLevel>>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Map a protected-router path (base + `/api` already stripped) to its scope module. */
export function tokenModuleForPath(path: string): TokenModuleKey | null {
  for (const m of TOKEN_MODULES) {
    for (const p of m.prefixes) {
      if (path === p || path.startsWith(`${p}/`))
        return m.key;
    }
  }
  return null;
}

/** Required scope level for a request method. */
export function levelForMethod(method: string): ScopeLevel {
  return SAFE_METHODS.has(method.toUpperCase()) ? "read" : "write";
}

/** Does a granted level satisfy a needed level? `write` implies `read`. */
export function scopeSatisfies(granted: ScopeLevel | undefined, need: ScopeLevel): boolean {
  if (!granted)
    return false;
  if (granted === "write")
    return true;
  return need === "read";
}

/** True when every key is a known module and every value a valid level. */
export function isValidScopeInput(scopes: Record<string, unknown>): boolean {
  return Object.entries(scopes).every(
    ([key, value]) => TOKEN_MODULE_KEY_SET.has(key) && (value === "read" || value === "write"),
  );
}

/** Parse a stored scope JSON map, dropping anything unknown. */
export function parseScopes(raw: string): TokenScopeMap {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: TokenScopeMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (TOKEN_MODULE_KEY_SET.has(key) && (value === "read" || value === "write"))
        result[key as TokenModuleKey] = value;
    }
    return result;
  }
  catch {
    return {};
  }
}
