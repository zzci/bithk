/* eslint-disable react-refresh/only-export-components */
// `ship-profile` section tab route.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { ProjectShipProfileTab } from "./-project-ship-profile-tab";
import { useProjectSectionRoute } from "./-project-section-route";

export const Route = createLazyFileRoute("/_app/projects/$projectId/profile")({
  component: ProjectShipProfileRoute,
});

function ProjectShipProfileRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/profile" });
  const { project, caps } = useProjectSectionRoute(projectId, "ship-profile");

  if (!project)
    return null;

  return <ProjectShipProfileTab project={project} canManage={caps.canManageProject} />;
}
