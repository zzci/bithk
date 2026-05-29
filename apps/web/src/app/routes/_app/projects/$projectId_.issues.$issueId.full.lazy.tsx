/* eslint-disable react-refresh/only-export-components */
// Standalone fullscreen page for a project work order, reached via the drawer's
// "maximize" action or a deep link. Non-nested (note the `$projectId_` segment)
// so it replaces the project page rather than overlaying it.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectIssuePanel } from "./-project-issue-panel";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId_/issues/$issueId/full")({
  component: ProjectIssueFullscreenPage,
});

function ProjectIssueFullscreenPage() {
  const { projectId, issueId } = useParams({ from: "/_app/projects/$projectId_/issues/$issueId/full" });
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
    // Return to the issues tab the work order belongs to, not the default overview.
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { tab: "issues" } });
  };

  return (
    <div className="h-full overflow-hidden">
      <ProjectIssuePanel
        projectId={projectId}
        issueId={issueId}
        members={members}
        userNames={userNames}
        canManage={caps.has("issue.manage")}
        variant="fullscreen"
        onClose={goBack}
      />
    </div>
  );
}
