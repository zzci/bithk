/* eslint-disable react-refresh/only-export-components */
// Overview tab route (project index). The detail layout guarantees the project
// is loaded before this Outlet renders; the cached query resolves immediately.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { PROJECT_TAB_TO } from "./-project-tabs";

export const Route = createLazyFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewRoute,
});

function ProjectOverviewRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/" });
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const caps = useProjectCapabilities(projectQuery.data);

  const project = projectQuery.data;
  if (!project)
    return null;

  return (
    <ProjectOverviewTab
      project={project}
      caps={caps}
      onOpenTab={tab => void navigate({ to: PROJECT_TAB_TO[tab], params: { projectId } })}
    />
  );
}
