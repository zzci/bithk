// Project detail tabs are first-class routes (one URL per tab) rather than a
// `?tab=` search param, so deep links, browser back/forward, and detail
// close/back all resolve to the correct tab. These pure helpers map between a
// tab key and its route, and back from a pathname to the active tab — kept
// framework-free so they are unit-testable without a router.
//
// Everything here is DERIVED from the section registry (`-project-sections.ts`)
// so a new section never edits this file: declare it there with its
// `routeSegment` and the tab list, `to` templates and pathname resolution
// follow.

import type { ProjectDetailTab } from "./-project-sections";
import { PROJECT_SECTIONS, sortedProjectSections } from "./-project-sections";

export type { ProjectDetailTab };

/** Every tab key, in registry (`order`) order. */
export const PROJECT_TABS: readonly ProjectDetailTab[] = sortedProjectSections().map(s => s.key as ProjectDetailTab);

/**
 * TanStack `to` templates for each tab; `overview` is the project index (its
 * registry entry declares an empty `routeSegment`).
 */
export const PROJECT_TAB_TO: Record<ProjectDetailTab, string> = Object.fromEntries(
  PROJECT_SECTIONS.map(s => [s.key, s.routeSegment ? `/projects/$projectId/${s.routeSegment}` : "/projects/$projectId"]),
) as Record<ProjectDetailTab, string>;

// Route segment → owning tab. Built once; the index (empty segment) is absent
// so an unknown or index path falls through to `overview`.
const TAB_BY_SEGMENT = new Map<string, ProjectDetailTab>(
  PROJECT_SECTIONS.filter(s => s.routeSegment !== "").map(s => [s.routeSegment, s.key as ProjectDetailTab]),
);

/**
 * Resolve the active tab from a pathname. Unknown / index paths fall back to
 * `overview`; nested detail routes (e.g. `…/issues/$issueId`) still resolve to
 * their owning tab so the tab nav stays highlighted while a drawer overlays it.
 */
export function activeProjectTab(pathname: string, projectId: string): ProjectDetailTab {
  const base = `/projects/${projectId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const segment = rest.split("/").filter(Boolean)[0];
  return (segment && TAB_BY_SEGMENT.get(segment)) || "overview";
}
