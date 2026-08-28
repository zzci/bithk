// Project detail section registry — the web mirror of the API's section
// registry (`apps/api/src/modules/project/section.registry.ts`).
//
// A project is a core record plus a set of MOUNTED SECTIONS; a section owns its
// own routes, capabilities and detail tab. This file is the single place that
// declares those tabs: the detail layout renders the registry filtered by
// `project.sections`, and `-project-tabs.ts` derives `PROJECT_TABS`,
// `PROJECT_TAB_TO` and `activeProjectTab` from it, so adding a section means
// adding an entry here plus a `$projectId.<segment>.{tsx,lazy.tsx}` pair.
//
// Two entries are NOT sections and are always visible or preset-gated instead:
//   - `overview`      the project index route; every project has it.
//   - `sub-projects`  the `/projects/:id/children` hierarchy. Children exist
//                     for every project on the API, but the tab follows the
//                     ship preset: it replaces the old ship↔project binding
//                     surface, and a plain project has no use for it in v1.
//
// Reserved order slots (leave gaps so new sections slot in cleanly):
//   10  Overview      — index route (`/projects/$projectId`)
//   20  Issues
//   30  Procurement
//   40  Files
//   50  Ship profile
//   60  Equipment
//   70  Worklist
//   80  Sub-projects
//
// Contract for new entries:
//   - `key`            stable id used for the Tabs value + React key. For a
//                      section it MUST equal the API's mount key.
//   - `labelKey`       i18n key WITHOUT its namespace (e.g. "tabs.equipment").
//   - `i18nNamespace`  namespace that key lives in; the tab body loads it too.
//   - `order`          sort position; pick an unused slot above.
//   - `routeSegment`   path segment under `/projects/$projectId`; "" = index.
//   - `capability`     capability required to VIEW the section, when it owns
//                      one. Sections without capabilities are visible to any
//                      project member once mounted.
//   - `isVisible`      the full predicate; build section entries with the
//                      `mounted` / `mountedWith` helpers so the rule stays
//                      "mounted AND permitted" everywhere.

import type { ProjectCapability, ProjectSectionKey, ProjectView } from "@/shared/lib/api/projects";

/** What every `isVisible` predicate gets. */
export interface ProjectSectionContext {
  /** The project being rendered; only its mounted `sections` are read. */
  readonly project: Pick<ProjectView, "sections">;
  /** Capability test from `useProjectCapabilities` (admins hold everything). */
  readonly has: (capability: ProjectCapability) => boolean;
}

export interface ProjectSectionDefinition {
  readonly key: string;
  readonly labelKey: string;
  readonly i18nNamespace: string;
  readonly order: number;
  /** Path segment under `/projects/$projectId`; "" for the index route. */
  readonly routeSegment: string;
  readonly capability?: ProjectCapability;
  readonly isVisible: (ctx: ProjectSectionContext) => boolean;
}

/** Visible whenever the project mounts `key`. */
function mounted(key: ProjectSectionKey) {
  return (ctx: ProjectSectionContext): boolean => ctx.project.sections.includes(key);
}

/** Visible when the project mounts `key` AND the caller holds `capability`. */
function mountedWith(key: ProjectSectionKey, capability: ProjectCapability) {
  return (ctx: ProjectSectionContext): boolean =>
    ctx.project.sections.includes(key) && ctx.has(capability);
}

export const PROJECT_SECTIONS = [
  { key: "overview", labelKey: "tabs.overview", i18nNamespace: "projects", order: 10, routeSegment: "", isVisible: () => true },
  { key: "issues", labelKey: "tabs.issues", i18nNamespace: "projects", order: 20, routeSegment: "issues", capability: "issue.view", isVisible: mountedWith("issues", "issue.view") },
  // Plural segment: it matches the existing drawer route (`…/procurements/$id`).
  { key: "procurement", labelKey: "tabs.procurement", i18nNamespace: "projects", order: 30, routeSegment: "procurements", capability: "procurement.view", isVisible: mountedWith("procurement", "procurement.view") },
  { key: "files", labelKey: "tabs.files", i18nNamespace: "projects", order: 40, routeSegment: "files", capability: "files.view", isVisible: mountedWith("files", "files.view") },
  { key: "ship-profile", labelKey: "tabs.profile", i18nNamespace: "ships", order: 50, routeSegment: "profile", isVisible: mounted("ship-profile") },
  { key: "equipment", labelKey: "tabs.equipment", i18nNamespace: "ships", order: 60, routeSegment: "equipment", isVisible: mounted("equipment") },
  { key: "worklist", labelKey: "tabs.worklist", i18nNamespace: "ships", order: 70, routeSegment: "worklist", isVisible: mounted("worklist") },
  { key: "sub-projects", labelKey: "tabs.projects", i18nNamespace: "ships", order: 80, routeSegment: "sub-projects", isVisible: mounted("ship-profile") },
] as const satisfies readonly ProjectSectionDefinition[];

/** Tab keys, as a literal union derived from the registry. */
export type ProjectDetailTab = typeof PROJECT_SECTIONS[number]["key"];

/** Registry entries sorted by `order` — the canonical tab order. */
export function sortedProjectSections(): readonly ProjectSectionDefinition[] {
  return [...PROJECT_SECTIONS].toSorted((a, b) => a.order - b.order);
}

/** Registry entries visible for the given context, in tab order. */
export function visibleProjectSections(ctx: ProjectSectionContext): readonly ProjectSectionDefinition[] {
  return sortedProjectSections().filter(section => section.isVisible(ctx));
}

/** A single entry by key; undefined for an unknown key. */
export function getProjectSection(key: string): ProjectSectionDefinition | undefined {
  return PROJECT_SECTIONS.find(section => section.key === key);
}

/**
 * Is `key`'s tab reachable for this project + caller? Route bodies call this
 * to render their own 404 when the section is not mounted, so a deep link to
 * an unmounted section never renders a half-broken tab.
 */
export function isProjectSectionVisible(key: ProjectDetailTab, ctx: ProjectSectionContext): boolean {
  return getProjectSection(key)?.isVisible(ctx) ?? false;
}
