/* eslint-disable react-refresh/only-export-components */
// Drawer route for a project work order. Nested under the project detail page so
// that page stays mounted underneath; the panel renders inside the shared
// accessible ResizableDrawer (focus-trap, focus restore, inert background,
// Escape, scroll-lock, keyboard-operable resize). "Maximize" navigates to the
// standalone fullscreen route at `…/issues/$issueId/full`.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
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
    // Return to the issues tab route the work order belongs to.
    void navigate({ to: "/projects/$projectId/issues", params: { projectId } });
  };

  return (
    <ResizableDrawer
      ariaLabel={t("detailTitle")}
      resizeLabel={t("resizeDrawer")}
      onClose={close}
    >
      <ProjectIssuePanel
        projectId={projectId}
        issueId={issueId}
        members={members}
        userNames={userNames}
        canManage={caps.canManageIssues}
        canComment={caps.canCommentIssues}
        variant="drawer"
        onClose={close}
        onMaximize={() => void navigate({
          to: "/projects/$projectId/issues/$issueId/full",
          params: { projectId, issueId },
        })}
      />
    </ResizableDrawer>
  );
}
