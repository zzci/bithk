/* eslint-disable react-refresh/only-export-components */
// Work-orders tab route. Renders the issues list plus an <Outlet/> so the
// nested issue drawer route (`…/issues/$issueId`) mounts over the list.

import { createLazyFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectIssuesTab } from "./-project-issues-tab";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId/issues")({
  component: ProjectIssuesRoute,
});

function ProjectIssuesRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/issues" });

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const caps = useProjectCapabilities(projectQuery.data);
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  return (
    <>
      <ProjectIssuesTab
        projectId={projectId}
        members={members}
        userNames={userNames}
        canManage={caps.has("issue.manage")}
      />
      <Outlet />
    </>
  );
}
