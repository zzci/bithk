/* eslint-disable react-refresh/only-export-components */
// Procurement tab route. Mounted only when the viewer has `procurement.view`;
// a direct URL hit without that capability redirects to the overview. Renders
// an <Outlet/> so the nested procurement drawer route mounts over the list.

import { createLazyFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectProcurementTab } from "./-project-procurement-tab";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId/procurements")({
  component: ProjectProcurementRoute,
});

function ProjectProcurementRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/procurements" });
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
    if (projectQuery.data && !caps.canViewProcurement)
      void navigate({ to: "/projects/$projectId", params: { projectId }, replace: true });
  }, [projectQuery.data, caps.canViewProcurement, navigate, projectId]);

  if (!caps.canViewProcurement)
    return null;

  return (
    <>
      <ProjectProcurementTab
        projectId={projectId}
        members={members}
        userNames={userNames}
        canManage={caps.canManageProcurement}
      />
      <Outlet />
    </>
  );
}
