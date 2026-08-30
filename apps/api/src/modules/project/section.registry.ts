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

/** What a section's `provision` hook gets when the section is mounted. */
export interface SectionProvisionContext {
  /**
   * The preset the project was created with, or undefined when the section was
   * mounted onto an existing project (`mountSection`) — a late mount answers to
   * no preset. A hook that reads it must handle the absent case.
   */
  readonly preset?: ProjectPreset;
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
   * Copy-on-mount hook, run inside the transaction that writes the mount row
   * (e.g. procurement copies the global category template). It runs on BOTH
   * mount paths — the preset at project creation and a later `mountSection` —
   * so "section mounted" and "the rows it seeds exist" stay equivalent
   * (PLAN-108 §5). Omit for sections that need no seeded data.
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
  /**
   * Soft-delete this section's own rows when the project is soft-deleted, in
   * the same transaction that stamps the project row (ADR-008). Only sections
   * MOUNTED on the project run, which loses nothing: `unmountSection` refuses
   * while `hasData` holds, and a data-owning section counts its soft-deleted
   * rows too, so a section that ever held rows is still mounted here. Omit it
   * for a section with nothing to cascade.
   *
   * Synchronous for the same reason `provision` is — bun:sqlite transactions
   * are, so a write deferred past an `await` would land after COMMIT, and the
   * `void | undefined` return makes an `async` hook a compile error.
   * `cascadeDeleteSections` keeps the equivalent runtime check.
   */
  readonly cascadeDelete?: (tx: AppTransaction, projectId: string, now: string) => void | undefined;
  /**
   * Batched contribution to a project LIST row: ONE query for the whole page,
   * keyed by internal project id. Never called per row.
   *
   * The project module folds the result into `ProjectView.sectionSummary[key]`
   * without interpreting it — the shape stays this section's own business, the
   * same way `sectionData` does on the way in. Omit it for a section the list
   * card renders nothing of.
   */
  readonly listSummary?: (db: AppDatabase, projectIds: readonly string[]) => Promise<Map<string, unknown>>;
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
