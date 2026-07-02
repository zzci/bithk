// Personal Access Token scope model (FEAT-034).
//
// A token carries a per-module access level — "read" (safe methods only),
// "write" (read + mutate), or none (key absent). The scope-module registry
// itself (`TOKEN_MODULES`) lives in the single module manifest
// (`@/shared/module-manifest`, REFACTOR-031) alongside the nav-module
// registry it supersets; `scope.test.ts` enumerates the real mounted routes
// and asserts each one maps to exactly one module there — a new route cannot
// ship unmapped. The guard is independent of the policy engine: effective
// access is `owner policy permissions ∩ token scope`.

import type { TokenModuleKey } from "@/shared/module-manifest";
import { TOKEN_MODULE_KEYS } from "@/shared/module-manifest";

export type ScopeLevel = "read" | "write";

/** Opaque secret prefix; also the leak-scanner marker. */
export const TOKEN_SECRET_PREFIX = "bithk_pat_";

export function isApiTokenSecret(value: string): boolean {
  return value.startsWith(TOKEN_SECRET_PREFIX);
}

const TOKEN_MODULE_KEY_SET = new Set<string>(TOKEN_MODULE_KEYS);

export type TokenScopeMap = Partial<Record<TokenModuleKey, ScopeLevel>>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
