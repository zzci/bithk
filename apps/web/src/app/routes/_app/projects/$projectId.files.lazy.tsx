/* eslint-disable react-refresh/only-export-components */
// Files tab route: the project-scoped drive surface.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProject } from "@/shared/lib/api/projects";
import { FileBrowser } from "../-file-browser";

export const Route = createLazyFileRoute("/_app/projects/$projectId/files")({
  component: ProjectFilesRoute,
});

function ProjectFilesRoute() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/files" });
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;

  if (!project)
    return null;

  return (
    // -mx-4 cancels the drive surface's internal px-4 gutter so file rows align
    // flush with the other tabs' content (the layout main has ≥16px horizontal
    // padding, so this never overflows).
    <div className="-mx-4 h-[calc(100svh-18rem)] min-h-[24rem]">
      <FileBrowser
        ownerType="project"
        ownerId={project.id}
        canManage
        rootLabel={project.name}
        showTitle={false}
        showSearch={false}
      />
    </div>
  );
}
