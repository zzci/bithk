/* eslint-disable react-refresh/only-export-components */
// Overview tab reached from a ship (`/projects/$projectId/from/$shipId`). It
// renders the same overview content as the plain index route; the `$shipId`
// path segment is what lets the detail layout offer a "back to ship" button.
// Because the ship lives in the path (not a search param) it survives a full
// reload. Switching to another tab navigates to the plain tab route and drops
// the ship context — full per-tab preservation would require duplicating the
// four-tab subtree, so it is intentionally best-effort here.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { PROJECT_TAB_TO } from "./-project-tabs";

export const Route = createLazyFileRoute("/_app/projects/$projectId/from/$shipId")({
  component: ProjectOverviewFromShipRoute,
});

function ProjectOverviewFromShipRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/from/$shipId" });
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
