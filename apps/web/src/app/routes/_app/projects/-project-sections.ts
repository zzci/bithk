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
//   - `filterLabelKey` label for the projects-list section filter, when the
//                      tab label does not read as a filter chip ("Details" is
//                      a fine tab, a poor chip). Same namespace as `labelKey`.
//   - `tile`           overview tile contribution: a mounted section with one
//                      gets a card on the project overview.
//   - `settingsPanel`  settings-dialog panel contribution: a mounted section
//                      with one gets its own nav entry in project settings.
//
// The capability -> section map (`CAPABILITY_SECTION`) mirrors the API's copy
// in `apps/api/src/modules/project/schema.ts`; it lives here so the Roles
// editor can group capabilities by section and hide the unmounted ones.

import type { LucideIcon } from "lucide-react";
import type { ProjectCapability, ProjectSectionKey, ProjectView } from "@/shared/lib/api/projects";
import { ClipboardList, FolderOpen, ListChecks, Package, Ship, Wrench } from "lucide-react";
import { PROJECT_SECTION_KEYS } from "@/shared/lib/api/projects";

/** What every `isVisible` predicate gets. */
export interface ProjectSectionContext {
  /** The project being rendered; only its mounted `sections` are read. */
  readonly project: Pick<ProjectView, "sections">;
  /** Capability test from `useProjectCapabilities` (admins hold everything). */
  readonly has: (capability: ProjectCapability) => boolean;
}

/**
 * Overview tile a section contributes. The registry supplies the presentation
 * (icon, and the label/route the entry already carries); the overview supplies
 * the metric, because a metric needs a hook and the registry holds no state.
 */
export interface ProjectSectionTile {
  readonly icon: LucideIcon;
}

/**
 * Settings-dialog panel a section contributes. Rendered as its own nav entry
 * while the section is mounted and the caller holds `capability`; the dialog
 * maps the section key to the component that fills the panel.
 */
export interface ProjectSectionSettingsPanel {
  /** i18n key WITHOUT its namespace; resolved in the entry's `i18nNamespace`. */
  readonly labelKey: string;
  readonly capability?: ProjectCapability;
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
  /** Overrides `labelKey` in the projects-list section filter only. */
  readonly filterLabelKey?: string;
  readonly tile?: ProjectSectionTile;
  readonly settingsPanel?: ProjectSectionSettingsPanel;
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
  { key: "issues", labelKey: "tabs.issues", i18nNamespace: "projects", order: 20, routeSegment: "issues", capability: "issue.view", isVisible: mountedWith("issues", "issue.view"), tile: { icon: ClipboardList } },
  // Plural segment: it matches the existing drawer route (`…/procurements/$id`).
  { key: "procurement", labelKey: "tabs.procurement", i18nNamespace: "projects", order: 30, routeSegment: "procurements", capability: "procurement.view", isVisible: mountedWith("procurement", "procurement.view"), tile: { icon: Package }, settingsPanel: { labelKey: "settings.tabs.categories", capability: "categories.manage" } },
  { key: "files", labelKey: "tabs.files", i18nNamespace: "projects", order: 40, routeSegment: "files", capability: "files.view", isVisible: mountedWith("files", "files.view"), tile: { icon: FolderOpen } },
  // The list filter says "Ships"; the tab says "Details" — same section, two
  // vocabularies (the sidebar preset link lands on this filter value).
  { key: "ship-profile", labelKey: "tabs.profile", i18nNamespace: "ships", order: 50, routeSegment: "profile", isVisible: mounted("ship-profile"), filterLabelKey: "list.filterLabel", tile: { icon: Ship } },
  { key: "equipment", labelKey: "tabs.equipment", i18nNamespace: "ships", order: 60, routeSegment: "equipment", isVisible: mounted("equipment"), tile: { icon: Wrench }, settingsPanel: { labelKey: "equipmentCategories.title", capability: "project.manage" } },
  { key: "worklist", labelKey: "tabs.worklist", i18nNamespace: "ships", order: 70, routeSegment: "worklist", isVisible: mounted("worklist"), tile: { icon: ListChecks } },
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

/**
 * Registry entries that are REAL sections — the keys the API accepts as a
 * mount, a `?section=` filter value or a `sections/:key` path segment.
 * `overview` and `sub-projects` are tabs, not sections, so they are excluded.
 */
export function mountableProjectSections(): readonly ProjectSectionDefinition[] {
  return sortedProjectSections().filter(section => isProjectSectionKey(section.key));
}

/** Narrowing guard: is `key` one of the API's section mount keys? */
export function isProjectSectionKey(key: string): key is ProjectSectionKey {
  return (PROJECT_SECTION_KEYS as readonly string[]).includes(key);
}

/**
 * Fully-namespaced i18n key for an entry's label in the projects-list section
 * filter — `filterLabelKey` when the entry overrides it, its tab label else.
 */
export function projectSectionFilterLabelKey(section: ProjectSectionDefinition): string {
  return `${section.i18nNamespace}:${section.filterLabelKey ?? section.labelKey}`;
}

/** Fully-namespaced i18n key for an entry's tab / tile label. */
export function projectSectionLabelKey(section: ProjectSectionDefinition): string {
  return `${section.i18nNamespace}:${section.labelKey}`;
}

// ── Capability ↔ section mirror ──
//
// MIRRORS `CAPABILITY_SECTION` in `apps/api/src/modules/project/schema.ts`.
// Kept in exactly one exported place (not inlined into the Roles editor) so a
// parity test can compare the two maps key for key.

/** Capabilities every project has, whatever it mounts. */
export const PROJECT_CORE_SECTION = "core";

export const CAPABILITY_SECTION: Record<ProjectCapability, string> = {
  "issue.view": "issues",
  "issue.comment": "issues",
  "issue.manage": "issues",
  "procurement.view": "procurement",
  "procurement.comment": "procurement",
  "procurement.manage": "procurement",
  "files.view": "files",
  "files.manage": "files",
  // Procurement categories are procurement-domain data (PLAN-108 §3).
  "categories.manage": "procurement",
  "members.manage": PROJECT_CORE_SECTION,
  "roles.manage": PROJECT_CORE_SECTION,
  "project.manage": PROJECT_CORE_SECTION,
};

/**
 * Should the Roles editor offer this capability? Core capabilities always;
 * a section's capabilities only while the project mounts that section — a role
 * cannot usefully grant access to a surface the project does not have.
 */
export function isCapabilityOffered(capability: ProjectCapability, sections: readonly string[]): boolean {
  const section = CAPABILITY_SECTION[capability];
  return section === PROJECT_CORE_SECTION || sections.includes(section);
}
