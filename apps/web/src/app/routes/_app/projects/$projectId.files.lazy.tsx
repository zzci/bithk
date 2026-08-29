/* eslint-disable react-refresh/only-export-components */
// Files tab route: the project-scoped drive surface.

import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { FileBrowser } from "../-file-browser";
import { useProjectSectionRoute } from "./-project-section-route";

export const Route = createLazyFileRoute("/_app/projects/$projectId/files")({
  component: ProjectFilesRoute,
});

function ProjectFilesRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/files" });
  const navigate = useNavigate();
  // 404s the deep link when the project does not mount `files`.
  const { project, caps } = useProjectSectionRoute(projectId, "files");

  // Once the project (and thus caps) resolves, bounce viewers without access
  // back to the overview rather than rendering a tab they cannot see.
  useEffect(() => {
    if (project && !caps.canViewFiles)
      void navigate({ to: "/projects/$projectId", params: { projectId }, replace: true });
  }, [project, caps.canViewFiles, navigate, projectId]);

  if (!project || !caps.canViewFiles)
    return null;

  return (
    // -mx-4 cancels the drive surface's internal px-4 gutter so file rows align
    // flush with the other tabs' content (the layout main has ≥16px horizontal
    // padding, so this never overflows). `flex-1 min-h-0` takes the height the
    // detail layout has left over instead of guessing it from the viewport, and
    // keeps the file list's own scroll area the only thing that scrolls.
    <div className="-mx-4 min-h-0 flex-1">
      <FileBrowser
        ownerType="project"
        ownerId={project.id}
        canManage={caps.canManageFiles}
        rootLabel={project.name}
        features={{ search: false }}
      />
    </div>
  );
}
