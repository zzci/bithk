// Nav-module registry facade. The canonical prefix→module data lives in the
// single module manifest (`shared/module-manifest.ts`, REFACTOR-031); this
// module keeps the historical import path for nav-gate consumers.
export type { ModuleDefinition, ModuleKey } from "./module-manifest";
export { MODULE_KEYS, MODULES } from "./module-manifest";
