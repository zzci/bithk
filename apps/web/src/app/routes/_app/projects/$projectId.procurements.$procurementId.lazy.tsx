/* eslint-disable react-refresh/only-export-components */
// Drawer route for a project procurement. Nested under the project detail page
// so that page stays mounted underneath; the panel renders inside the shared
// accessible ResizableDrawer (focus-trap, focus restore, inert background,
// Escape, scroll-lock, keyboard-operable resize). "Maximize" navigates to the
// standalone fullscreen route at `…/procurements/$procurementId/full`.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectProcurementPanel } from "./-project-procurement-panel";

export const Route = createLazyFileRoute("/_app/projects/$projectId/procurements/$procurementId")({
  component: ProjectProcurementDrawer,
});

function ProjectProcurementDrawer() {
  const { projectId, procurementId } = useParams({ from: "/_app/projects/$projectId/procurements/$procurementId" });
  const navigate = useNavigate();
  const { t } = useTranslation("projects");

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const caps = useProjectCapabilities(projectQuery.data);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const close = () => {
    // Return to the procurement tab route, not the default overview.
    void navigate({ to: "/projects/$projectId/procurements", params: { projectId } });
  };

  return (
    <ResizableDrawer
      ariaLabel={t("procurement.detail.title")}
      resizeLabel={t("procurement.detail.resizeDrawer")}
      onClose={close}
    >
      <ProjectProcurementPanel
        projectId={projectId}
        procurementId={procurementId}
        members={members}
        userNames={userNames}
        canManage={caps.canManageProcurement}
        canComment={caps.canCommentProcurement}
        variant="drawer"
        onClose={close}
        onMaximize={() => void navigate({
          to: "/projects/$projectId/procurements/$procurementId/full",
          params: { projectId, procurementId },
        })}
      />
    </ResizableDrawer>
  );
}
