// Mirrors the API's static module registry (apps/api/src/shared/modules.ts).
// Drives the module-grant switch table in the admin groups dialog (FEAT-032).
export const MODULE_KEYS = ["documents", "drive", "projects", "ships", "contacts", "hr"] as const;
export type ModuleKey = typeof MODULE_KEYS[number];
