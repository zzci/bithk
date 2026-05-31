/* eslint-disable react-refresh/only-export-components */
// Standalone fullscreen page for a project procurement, reached via the drawer's
// "maximize" action or a deep link. Non-nested (note the `$projectId_` segment)
// so it replaces the project page rather than overlaying it.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectProcurementPanel } from "./-project-procurement-panel";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId_/procurements/$procurementId/full")({
  component: ProjectProcurementFullscreenPage,
});

function ProjectProcurementFullscreenPage() {
  const { projectId, procurementId } = useParams({ from: "/_app/projects/$projectId_/procurements/$procurementId/full" });
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const caps = useProjectCapabilities(projectQuery.data);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const goBack = () => {
    // Return to the procurement tab route, not the default overview.
    void navigate({ to: "/projects/$projectId/procurements", params: { projectId } });
  };

  return (
    <div className="h-full overflow-hidden">
      <ProjectProcurementPanel
        projectId={projectId}
        procurementId={procurementId}
        members={members}
        userNames={userNames}
        canManage={caps.canManageProcurement}
        canComment={caps.canCommentProcurement}
        variant="fullscreen"
        onClose={goBack}
      />
    </div>
  );
}
