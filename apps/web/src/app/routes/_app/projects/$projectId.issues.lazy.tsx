/* eslint-disable react-refresh/only-export-components */
// Work-orders tab route. Renders the issues list plus an <Outlet/> so the
// nested issue drawer route (`…/issues/$issueId`) mounts over the list.

import { createLazyFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectIssuesTab } from "./-project-issues-tab";

export const Route = createLazyFileRoute("/_app/projects/$projectId/issues")({
  component: ProjectIssuesRoute,
});

function ProjectIssuesRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/issues" });
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const caps = useProjectCapabilities(projectQuery.data);
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  // Once the project (and thus caps) resolves, bounce viewers without access
  // back to the overview rather than rendering a tab they cannot see.
  useEffect(() => {
    if (projectQuery.data && !caps.canViewIssues)
      void navigate({ to: "/projects/$projectId", params: { projectId }, replace: true });
  }, [projectQuery.data, caps.canViewIssues, navigate, projectId]);

  if (!caps.canViewIssues)
    return null;

  return (
    <>
      <ProjectIssuesTab
        projectId={projectId}
        members={members}
        userNames={userNames}
        canManage={caps.canManageIssues}
        shipId={projectQuery.data?.shipId ?? null}
      />
      <Outlet />
    </>
  );
}
