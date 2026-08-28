/* eslint-disable react-refresh/only-export-components */
// Sub-projects tab route (`/projects/:id/children`).

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { ProjectChildrenTab } from "./-project-children-tab";
import { useProjectSectionRoute } from "./-project-section-route";

export const Route = createLazyFileRoute("/_app/projects/$projectId/sub-projects")({
  component: ProjectChildrenRoute,
});

function ProjectChildrenRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/sub-projects" });
  const { project, caps } = useProjectSectionRoute(projectId, "sub-projects");

  if (!project)
    return null;

  return <ProjectChildrenTab project={project} canManage={caps.canManageProject} />;
}
