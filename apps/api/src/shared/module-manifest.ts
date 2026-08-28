// Single module manifest (REFACTOR-031). The one place that maps protected
// route prefixes to modules; the nav-module registry (`MODULES`), the module
// gate's ungated allowlist (`UNGATED_PREFIXES`) and the PAT scope registry
// (`TOKEN_MODULES`) are all DERIVED from it, so a new module edits exactly one
// list. Keep it dependency-free.
//
// Each entry claims an ordered group of prefixes for one token-scope module:
// - `navKey` — the prefixes belong to a gateable main-area nav module
//   (FEAT-032: group-based visibility, 404 concealment for hidden modules,
//   `/account/me`'s `modules` payload). Admin-only surfaces (`/global-*`,
//   `/contact-categories`, `/worklists`, `/admin`, …) carry no `navKey`:
//   admin-area routes stay admin-gated and are not role-grantable in v1.
// - `ungated` — the prefixes are mounted on the protected router but
//   deliberately NOT gated by module visibility. The gate coverage test
//   asserts every mounted prefix is either claimed by exactly one nav module
//   or listed ungated — so a new module cannot be mounted unmapped by
//   accident. Reasons, per group: `/account`, `/search`, `/tags`, `/policy`,
//   `/settings`, `/currencies` are cross-cutting surfaces every authenticated
//   user needs (search filters per-module inside its own handler); `/shares`
//   is cross-cutting share management; `/admin`, `/audit`, `/backup`, `/cron`,
//   `/global-*`, `/contact-categories`, `/worklists` keep their existing
//   `adminRequired` guards; `/files` is attachment infrastructure whose routes
//   enforce their own per-resource permission hooks; `/overview` +
//   `/favorites` are workbench home surfaces (FEAT-048) whose handlers filter
//   by the actor's visible modules (like `/search`).
// - neither flag — the prefixes only exist for PAT scoping (mounted outside
//   the protected router, or nested under an already-allowlisted prefix).
//
// The token-scope registry derived from this manifest is a SUPERSET of the
// nav modules: it must cover EVERY protected route so a token can be scoped
// down to any part of the API (`scope.test.ts` enforces coverage). Matching
// is first-match-wins in manifest order. Prefixes are disjoint with ONE
// deliberate, ordered exception: `/admin/project-default-cover` (a
// project-domain setting that happens to be mounted under `/admin`) is
// claimed for `projects` above the `account` entry that owns the rest of
// `/admin`, so a project-scoped token — not an account-scoped one — governs
// it.
//
// Prefixes verified against the live mounts in `routes/protected.ts` (every
// module mounts at "/" and declares absolute paths):
//   documents — `/documents` plus `/shared` (share-token access surface).
//   projects  — `/projects` plus `/issues` (issue references mount at
//               `/issues/*`; procurement, equipment, ship profiles and
//               worklists all nest under `/projects/*` as sections).
//   projects (scope-only) — `/overview` + `/favorites` (FEAT-048 workbench):
//               every favoritable/aggregated target type in v1 is
//               projects-domain content.
export interface ModuleManifestEntry {
  readonly prefixes: readonly string[];
  readonly navKey?: string;
  readonly tokenScopeKey: string;
  readonly ungated?: boolean;
}

export const MODULE_MANIFEST = [
  { prefixes: ["/documents", "/shared"], navKey: "documents", tokenScopeKey: "documents" },
  { prefixes: ["/drive"], navKey: "drive", tokenScopeKey: "drive" },
  { prefixes: ["/files"], tokenScopeKey: "files", ungated: true },
  { prefixes: ["/projects", "/issues"], navKey: "projects", tokenScopeKey: "projects" },
  { prefixes: ["/global-procurement-categories", "/overview", "/favorites"], tokenScopeKey: "projects", ungated: true },
  // Nested under the already-ungated `/admin`; exists only to route PAT scope
  // checks for the project-default-cover setting to `projects` (see above).
  { prefixes: ["/admin/project-default-cover"], tokenScopeKey: "projects" },
  { prefixes: ["/worklists", "/global-equipment-categories", "/global-equipment-manufacturers"], tokenScopeKey: "projects", ungated: true },
  { prefixes: ["/contacts"], navKey: "contacts", tokenScopeKey: "contacts" },
  { prefixes: ["/contact-categories"], tokenScopeKey: "contacts", ungated: true },
  { prefixes: ["/hr"], navKey: "hr", tokenScopeKey: "hr" },
  { prefixes: ["/tags"], tokenScopeKey: "tags", ungated: true },
  { prefixes: ["/shares"], tokenScopeKey: "shares", ungated: true },
  { prefixes: ["/search"], tokenScopeKey: "search", ungated: true },
  { prefixes: ["/account", "/admin"], tokenScopeKey: "account", ungated: true },
  { prefixes: ["/settings", "/currencies"], tokenScopeKey: "settings", ungated: true },
  { prefixes: ["/policy"], tokenScopeKey: "policy", ungated: true },
  { prefixes: ["/audit"], tokenScopeKey: "audit", ungated: true },
  { prefixes: ["/backup"], tokenScopeKey: "backup", ungated: true },
  { prefixes: ["/cron"], tokenScopeKey: "cron", ungated: true },
  // Mounted outside the protected router; listed for PAT scoping only.
  { prefixes: ["/system", "/health", "/metrics"], tokenScopeKey: "system" },
] as const satisfies readonly ModuleManifestEntry[];

export type ModuleKey = Extract<typeof MODULE_MANIFEST[number], { navKey: string }>["navKey"];

export type TokenModuleKey = typeof MODULE_MANIFEST[number]["tokenScopeKey"];

export interface ModuleDefinition {
  readonly key: ModuleKey;
  readonly prefixes: readonly string[];
}

export interface TokenModuleDefinition {
  readonly key: TokenModuleKey;
  readonly prefixes: readonly string[];
}

/** Gateable nav modules, in manifest (= registry) order. */
export const MODULES: readonly ModuleDefinition[] = MODULE_MANIFEST.flatMap(e =>
  "navKey" in e ? [{ key: e.navKey, prefixes: e.prefixes }] : [],
);

export const MODULE_KEYS: readonly ModuleKey[] = MODULES.map(m => m.key);

/**
 * Protected-router prefixes deliberately NOT gated by module visibility (see
 * the manifest header for the per-group reasons).
 */
export const UNGATED_PREFIXES: readonly string[] = MODULE_MANIFEST
  .filter(e => "ungated" in e && e.ungated)
  .flatMap(e => e.prefixes)
  .sort();

/** PAT scope modules: prefixes grouped by scope key, in manifest order. */
export const TOKEN_MODULES: readonly TokenModuleDefinition[] = (() => {
  const byKey = new Map<TokenModuleKey, string[]>();
  for (const e of MODULE_MANIFEST) {
    const prefixes = byKey.get(e.tokenScopeKey) ?? [];
    prefixes.push(...e.prefixes);
    byKey.set(e.tokenScopeKey, prefixes);
  }
  return [...byKey].map(([key, prefixes]) => ({ key, prefixes }));
})();

export const TOKEN_MODULE_KEYS: readonly TokenModuleKey[] = TOKEN_MODULES.map(m => m.key);

/** First-match-wins prefix matcher shared by the nav gate and PAT scoping. */
function matchModuleForPath<K extends string>(
  path: string,
  registry: ReadonlyArray<{ readonly key: K; readonly prefixes: readonly string[] }>,
): K | null {
  for (const m of registry) {
    for (const p of m.prefixes) {
      if (path === p || path.startsWith(`${p}/`))
        return m.key;
    }
  }
  return null;
}

/** Map a protected-router path to the nav module claiming it, if any. */
export function moduleForPath(path: string): ModuleKey | null {
  return matchModuleForPath(path, MODULES);
}

/** Map a protected-router path (base + `/api` already stripped) to its scope module. */
export function tokenModuleForPath(path: string): TokenModuleKey | null {
  return matchModuleForPath(path, TOKEN_MODULES);
}
