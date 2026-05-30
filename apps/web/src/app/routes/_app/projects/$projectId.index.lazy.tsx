/* eslint-disable react-refresh/only-export-components */
// Overview tab route (project index). The detail layout guarantees the project
// is loaded before this Outlet renders; the cached query resolves immediately.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProject } from "@/shared/lib/api/projects";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { PROJECT_TAB_TO } from "./-project-tabs";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewRoute,
});

function ProjectOverviewRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/" });
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const usersQuery = useVisibleUsers();
  const caps = useProjectCapabilities(projectQuery.data);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const project = projectQuery.data;
  if (!project)
    return null;

  return (
    <ProjectOverviewTab
      project={project}
      userNames={userNames}
      caps={caps}
      onOpenTab={tab => void navigate({ to: PROJECT_TAB_TO[tab], params: { projectId } })}
    />
  );
}
