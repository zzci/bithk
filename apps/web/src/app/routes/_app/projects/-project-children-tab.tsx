// Sub-projects tab: the project's children (`/projects/:id/children`). Core for
// every project, ship preset or not — `parent_id` is a core column and the API
// serves children whatever the project mounts. The hierarchy is exactly ONE
// level deep — a child can never become a parent — and unlinking never deletes
// the child, it only clears the link.

import type { ProjectView } from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, Info, Link2Off, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useProjectChildren, useUnlinkProjectChild } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { ProjectChildAddDialog } from "./-project-child-add-dialog";

interface ProjectChildrenTabProps {
  readonly project: ProjectView;
  readonly canManage: boolean;
}

export function ProjectChildrenTab({ project, canManage }: ProjectChildrenTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();

  const childrenQuery = useProjectChildren(project.id);
  const unlink = useUnlinkProjectChild();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<ProjectView | null>(null);

  const children = childrenQuery.data ?? [];

  const handleUnlink = () => {
    if (!unlinkTarget)
      return;
    unlink.mutate(
      { parentId: project.id, childId: unlinkTarget.id },
      { onSuccess: () => setUnlinkTarget(null) },
    );
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setPickerOpen(true)}>
            <Plus aria-hidden="true" />
            {t("common:common.create")}
          </Button>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>{t("subProjects.callout")}</p>
      </div>

      {unlink.error && <ErrorBanner message={errorMessage(unlink.error, t("common:common.error.operationFailed"))} />}
      {childrenQuery.error && <ErrorBanner message={errorMessage(childrenQuery.error, t("common:common.error.loadFailed"))} />}

      {childrenQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("common:common.loading")}</p>
        : children.length === 0
          ? <p className="text-sm text-muted-foreground">{t("subProjects.empty")}</p>
          : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {children.map(child => (
                  <div key={child.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <span className="truncate text-sm font-medium">{child.name}</span>
                        {child.code && <p className="truncate font-mono text-xs text-muted-foreground">{child.code}</p>}
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs">{t(`projects:status.${child.status}` as const)}</Badge>
                    </div>
                    {child.description && <p className="line-clamp-2 text-xs text-muted-foreground">{child.description}</p>}
                    {child.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {child.tags.slice(0, 4).map(tag => <Badge key={tag.id} variant="outline" className="text-xs">{tag.name}</Badge>)}
                      </div>
                    )}
                    <div className="flex items-center gap-1 border-t border-dashed pt-2">
                      <Button
                        variant="ghost"
                        onClick={() => void navigate({ to: "/projects/$projectId", params: { projectId: child.id } })}
                      >
                        <ExternalLink className="mr-1 size-4" />
                        {t("subProjects.open")}
                      </Button>
                      {canManage && (
                        <Button variant="ghost" onClick={() => setUnlinkTarget(child)}>
                          <Link2Off className="mr-1 size-4 text-destructive" />
                          {t("subProjects.unbind")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

      {canManage && (
        <ProjectChildAddDialog
          parentId={project.id}
          linkedIds={children.map(c => c.id)}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />
      )}

      <ConfirmDeleteDialog
        open={unlinkTarget !== null}
        onOpenChange={open => !open && setUnlinkTarget(null)}
        title={t("subProjects.unbindTitle")}
        description={t("subProjects.unbindConfirm", { name: unlinkTarget?.name ?? "" })}
        confirmLabel={t("subProjects.unbind")}
        pending={unlink.isPending}
        onConfirm={handleUnlink}
      />
    </div>
  );
}
