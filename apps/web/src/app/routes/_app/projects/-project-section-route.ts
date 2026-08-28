// Shared guard for the section tab routes.
//
// Every section surface answers 404 on the API while its key is not mounted,
// and the tab nav only offers mounted sections — but a deep link (or a stale
// bookmark from before a section was unmounted) can still land on the route.
// This hook resolves the project, waits for it, and then throws the router's
// `notFound()` so the URL renders the app's 404 page instead of an empty tab.

import type { ProjectDetailTab } from "./-project-sections";
import type { ProjectCapabilityInfo } from "@/shared/hooks/use-project-capabilities";
import type { ProjectView } from "@/shared/lib/api/projects";
import { notFound } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { isProjectSectionVisible } from "./-project-sections";

export interface ProjectSectionRoute {
  /** Undefined while the project is still loading — render nothing until then. */
  readonly project: ProjectView | undefined;
  readonly caps: ProjectCapabilityInfo;
}

export function useProjectSectionRoute(projectId: string, key: ProjectDetailTab): ProjectSectionRoute {
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const caps = useProjectCapabilities(project);

  // Only decide once the project has resolved: an in-flight query has no
  // `sections` yet, and 404-ing on that would flash for every deep link.
  //
  // The mount is the only thing checked here: the entry is evaluated as if the
  // caller held every capability, so a section that IS mounted but whose view
  // capability the caller lacks stays a redirect to the overview (the route
  // body owns that) rather than becoming a 404.
  if (project && !isProjectSectionVisible(key, { project, has: () => true }))
    throw notFound();

  return { project, caps };
}
