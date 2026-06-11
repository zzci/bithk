// Static registry of gateable main-area modules. Each entry maps a module key
// to the route prefixes that module owns on the protected router; the module
// gate (404 concealment for hidden modules) and `/account/me`'s `modules`
// payload are both derived from this const. Keep it dependency-free.
//
// Prefixes verified against the live mounts in `routes/protected.ts` (every
// module mounts at "/" and declares absolute paths):
//   documents — `/documents` plus `/shared` (share-token access surface).
//   projects  — `/projects` plus `/issues` (issue references mount at
//               `/issues/*`; procurements/worklists nest under `/projects/*`).
// Admin-only surfaces (`/global-*`, `/contact-categories`, `/worklists`,
// `/admin`, …) are NOT listed: admin-area routes stay admin-gated and are not
// role-grantable in v1. Cross-cutting share management (`/shares`) is also
// deliberately ungated here.
export interface ModuleDefinition {
  readonly key: string;
  readonly prefixes: readonly string[];
}

export const MODULES = [
  { key: "documents", prefixes: ["/documents", "/shared"] },
  { key: "drive", prefixes: ["/drive"] },
  { key: "projects", prefixes: ["/projects", "/issues"] },
  { key: "ships", prefixes: ["/ships"] },
  { key: "contacts", prefixes: ["/contacts"] },
  { key: "hr", prefixes: ["/hr"] },
] as const satisfies readonly ModuleDefinition[];

export type ModuleKey = typeof MODULES[number]["key"];

export const MODULE_KEYS: readonly ModuleKey[] = MODULES.map(m => m.key);
