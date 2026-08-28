/* eslint-disable react-refresh/only-export-components */
// Procurement tab route. The URL exists only while the project mounts the
// `procurement` section, and is visible only to a viewer holding
// `procurement.view`; a direct hit without that capability redirects to the
// overview. Renders an <Outlet/> so the nested procurement drawer route mounts
// over the list.

import { createLazyFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectProcurementTab } from "./-project-procurement-tab";
import { useProjectSectionRoute } from "./-project-section-route";

export const Route = createLazyFileRoute("/_app/projects/$projectId/procurements")({
  component: ProjectProcurementRoute,
});

function ProjectProcurementRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/procurements" });
  const navigate = useNavigate();

  // Plural segment, singular section key — the key comes from the registry.
  const { project, caps } = useProjectSectionRoute(projectId, "procurement");
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  // Once the project (and thus caps) resolves, bounce viewers without access
  // back to the overview rather than rendering a tab they cannot see.
  useEffect(() => {
    if (project && !caps.canViewProcurement)
      void navigate({ to: "/projects/$projectId", params: { projectId }, replace: true });
  }, [project, caps.canViewProcurement, navigate, projectId]);

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
