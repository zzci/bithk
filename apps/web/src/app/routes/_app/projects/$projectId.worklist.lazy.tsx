/* eslint-disable react-refresh/only-export-components */
// `worklist` section tab route.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProjectSectionRoute } from "./-project-section-route";
import { ProjectWorklistTab } from "./-project-worklist-tab";

export const Route = createLazyFileRoute("/_app/projects/$projectId/worklist")({
  component: ProjectWorklistRoute,
});

function ProjectWorklistRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/worklist" });
  const { project, caps } = useProjectSectionRoute(projectId, "worklist");

  if (!project)
    return null;

  return <ProjectWorklistTab project={project} canManage={caps.canManageProject} />;
}
