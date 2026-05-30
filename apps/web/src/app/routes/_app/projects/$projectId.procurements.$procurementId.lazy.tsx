/* eslint-disable react-refresh/only-export-components */
// Drawer route for a project procurement. Nested under the project detail page
// so that page stays mounted underneath; the panel renders inside a Sheet that
// overlays from the right. "Maximize" navigates to the standalone fullscreen
// route at `…/procurements/$procurementId/full`.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/components/ui/sheet";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectProcurementPanel } from "./-project-procurement-panel";
import { useProjectCapabilities } from "./-use-project-role";

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
    <Sheet open onOpenChange={open => !open && close()}>
      <SheetContent side="right" showCloseButton={false} className="flex w-[90vw] max-w-2xl flex-col gap-0 bg-background p-0">
        <SheetTitle className="sr-only">{t("procurement.detail.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("procurement.detail.description")}</SheetDescription>
        <ProjectProcurementPanel
          projectId={projectId}
          procurementId={procurementId}
          members={members}
          userNames={userNames}
          canManage={caps.has("procurement.manage")}
          variant="drawer"
          onClose={close}
          onMaximize={() => void navigate({
            to: "/projects/$projectId/procurements/$procurementId/full",
            params: { projectId, procurementId },
          })}
        />
      </SheetContent>
    </Sheet>
  );
}
