/* eslint-disable react-refresh/only-export-components */
// Drawer route for a project work order. Nested under the project detail page
// so that page stays mounted underneath; the panel renders inside a Sheet that
// overlays from the right. "Maximize" navigates to the standalone fullscreen
// route at `…/issues/$issueId/full`.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/components/ui/sheet";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectIssuePanel } from "./-project-issue-panel";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId/issues/$issueId")({
  component: ProjectIssueDrawer,
});

function ProjectIssueDrawer() {
  const { projectId, issueId } = useParams({ from: "/_app/projects/$projectId/issues/$issueId" });
  const navigate = useNavigate();
  const { t } = useTranslation("issues");

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
    void navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  return (
    <Sheet open onOpenChange={open => !open && close()}>
      <SheetContent side="right" showCloseButton={false} className="flex w-[90vw] max-w-xl flex-col gap-0 bg-background p-0">
        <SheetTitle className="sr-only">{t("page.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("page.description")}</SheetDescription>
        <ProjectIssuePanel
          projectId={projectId}
          issueId={issueId}
          members={members}
          userNames={userNames}
          canManage={caps.has("issue.manage")}
          variant="drawer"
          onClose={close}
          onMaximize={() => void navigate({
            to: "/projects/$projectId/issues/$issueId/full",
            params: { projectId, issueId },
          })}
        />
      </SheetContent>
    </Sheet>
  );
}
