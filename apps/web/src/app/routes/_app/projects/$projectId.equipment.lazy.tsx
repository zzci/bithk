/* eslint-disable react-refresh/only-export-components */
// `equipment` section tab route.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { ProjectEquipmentTab } from "./-project-equipment-tab";
import { useProjectSectionRoute } from "./-project-section-route";

export const Route = createLazyFileRoute("/_app/projects/$projectId/equipment")({
  component: ProjectEquipmentRoute,
});

function ProjectEquipmentRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/equipment" });
  const { project, caps } = useProjectSectionRoute(projectId, "equipment");

  if (!project)
    return null;

  return <ProjectEquipmentTab project={project} canManage={caps.canManageProject} />;
}
