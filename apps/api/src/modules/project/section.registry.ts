// Project section registry (PLAN-108 §3). A project is a core record plus a
// set of mounted sections; a section is an independent sub-module owning its
// own tables, routes, capabilities and UI tab. This file is the registration
// surface, and it is deliberately dependency-free — like
// `shared/module-manifest.ts`, it imports types only, never a domain module.
// Sections register themselves from their OWNING module's barrel (ADR-009), so
// the project module never imports the modules it hosts.
//
// Hard design limit (PLAN-108 §9): this stays a static list. No runtime /
// dynamic plugin loading, no per-section JSON config column, no section
// versioning, no per-section membership or roles. A section is plain code that
// registers itself; the only data is the mount row.

import type { ProjectCapability } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";

/** What a section's `provision` hook gets when a project is created. */
export interface SectionProvisionContext {
  readonly preset: ProjectPreset;
  readonly now: string;
  readonly creatorId: string;
  /** Raw per-section create payload, keyed by section key (see CreateProjectInput.sectionData). */
  readonly sectionData: Readonly<Record<string, unknown>> | undefined;
}

export interface ProjectSectionDefinition {
  /** Mount key, e.g. "issues" | "procurement" | "ship-profile". */
  readonly key: string;
  /**
   * Capabilities this section owns. Compile-time checked against the single
   * `PROJECT_CAPABILITIES` literal; the reverse map lives in
   * `CAPABILITY_SECTION` (schema.ts).
   */
  readonly capabilities?: readonly ProjectCapability[];
  /**
   * Copy-on-create hook, run inside the project-creation transaction right
   * after the mount rows are written (e.g. procurement copies the global
   * category template). Omit for sections that need no seeded data.
   *
   * A provision hook MUST do all of its writing synchronously: bun:sqlite
   * transactions are synchronous, so anything a hook deferred past an `await`
   * would land after COMMIT. The return type is spelled `void | undefined`
   * rather than a bare `void` on purpose — TypeScript lets a function of any
   * return type satisfy a `void`-returning signature, so only the union makes
   * an `async` hook a compile error. `provisionSections` keeps the equivalent
   * runtime check as defence in depth.
   */
  readonly provision?: (tx: AppTransaction, projectId: string, ctx: SectionProvisionContext) => void | undefined;
  /**
   * Guards unmount: while this resolves true the section still holds data and
   * `unmountSection` refuses (no data loss, no soft "disabled" state). A
   * section without the hook is always unmountable.
   */
  readonly hasData?: (db: AppDatabase, projectId: string) => Promise<boolean>;
}

const registry = new Map<string, ProjectSectionDefinition>();

/** Register a section. Called once per section from its owning module barrel. */
export function registerProjectSection(def: ProjectSectionDefinition): void {
  if (registry.has(def.key))
    throw new Error(`Project section '${def.key}' is already registered`);
  registry.set(def.key, def);
}

export function getProjectSection(key: string): ProjectSectionDefinition | undefined {
  return registry.get(key);
}

/** Registered sections in registration order. */
export function listRegisteredSections(): readonly ProjectSectionDefinition[] {
  return [...registry.values()];
}

/** Test support only — never call from a production path. */
export function resetProjectSectionRegistry(): void {
  registry.clear();
}

/**
 * Create-time presets: which sections a new project mounts, in tab order.
 * A static map, not a table — "ship" is a preset, not a project type.
 */
export const PROJECT_PRESETS = {
  general: ["issues", "procurement", "files"],
  ship: ["issues", "procurement", "files", "ship-profile", "equipment", "worklist"],
} as const;

export type ProjectPreset = keyof typeof PROJECT_PRESETS;

export const DEFAULT_PROJECT_PRESET: ProjectPreset = "general";

/** Every key any preset can mount — the allowlist `mountSection` validates against. */
export const PRESET_SECTION_KEYS: readonly string[] = [
  ...new Set(Object.values(PROJECT_PRESETS).flat()),
];
