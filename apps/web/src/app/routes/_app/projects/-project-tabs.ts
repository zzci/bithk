// Project detail tabs are first-class routes (one URL per tab) rather than a
// `?tab=` search param, so deep links, browser back/forward, and detail
// close/back all resolve to the correct tab. These pure helpers map between a
// tab key and its route, and back from a pathname to the active tab — kept
// framework-free so they are unit-testable without a router.

export const PROJECT_TABS = ["overview", "issues", "procurement", "files"] as const;
export type ProjectDetailTab = typeof PROJECT_TABS[number];

// TanStack `to` templates for each tab; `overview` is the project index. The
// procurement segment is plural to match the existing drawer route
// (`…/procurements/$procurementId`).
export const PROJECT_TAB_TO: Record<ProjectDetailTab, string> = {
  overview: "/projects/$projectId",
  issues: "/projects/$projectId/issues",
  procurement: "/projects/$projectId/procurements",
  files: "/projects/$projectId/files",
};

/**
 * Resolve the active tab from a pathname. Unknown / index paths fall back to
 * `overview`; nested detail routes (e.g. `…/issues/$issueId`) still resolve to
 * their owning tab so the tab nav stays highlighted while a drawer overlays it.
 */
export function activeProjectTab(pathname: string, projectId: string): ProjectDetailTab {
  const base = `/projects/${projectId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const segment = rest.split("/").filter(Boolean)[0];
  if (segment === "issues")
    return "issues";
  if (segment === "procurements")
    return "procurement";
  if (segment === "files")
    return "files";
  return "overview";
}
