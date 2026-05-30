// Danger zone settings section: archive/restore and delete the project, each
// guarded by its own confirm dialog. Archiving toggles the project status via
// useUpdateProject; deleting soft-removes the project via useDeleteProject and
// navigates back to the project list on success. Gated by project.manage.

import type {
  ProjectView,
  UpdateProjectInput,
} from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  useDeleteProject,
  useUpdateProject,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

interface ProjectSettingsDangerProps {
  readonly project: ProjectView;
}

export function ProjectSettingsDanger({ project }: ProjectSettingsDangerProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isArchived = project.status === "archived";

  const confirmArchiveToggle = () => {
    if (updateProject.isPending)
      return;
    const nextStatus = isArchived ? "active" : "archived";
    // Send a complete UpdateProjectInput (not a partial) so the call type-checks
    // regardless of whether the input fields are optional, and so toggling the
    // status never clobbers the other fields.
    const values: UpdateProjectInput = {
      name: project.name,
      status: nextStatus,
      description: project.description ?? null,
      tags: project.tags.map(tag => tag.name),
    };
    updateProject.mutate({ id: project.id, ...values }, {
      onSuccess: () => {
        toast.success(t("toast.projectUpdated"));
        setArchiveOpen(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.saveFailed"))),
    });
  };

  const confirmDelete = () => {
    if (deleteProject.isPending)
      return;
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        toast.success(t("toast.projectDeleted"));
        setDeleteOpen(false);
        void navigate({ to: "/projects" });
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.saveFailed"))),
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-destructive/40 p-4">
        <h3 className="text-sm font-semibold text-destructive">{t("dangerZone.title")}</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setArchiveOpen(true)}
          >
            {isArchived ? t("dangerZone.restore") : t("dangerZone.archive")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            {t("dangerZone.delete")}
          </Button>
        </div>
      </section>

      <ConfirmDeleteDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={isArchived ? t("dangerZone.restoreConfirmTitle") : t("dangerZone.archiveConfirmTitle")}
        description={isArchived ? t("dangerZone.restoreConfirmDescription") : t("dangerZone.archiveConfirmDescription")}
        confirmLabel={isArchived ? t("dangerZone.restore") : t("dangerZone.archive")}
        onConfirm={confirmArchiveToggle}
        pending={updateProject.isPending}
      />

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("dangerZone.deleteConfirmTitle")}
        description={t("dangerZone.deleteConfirmDescription")}
        confirmLabel={t("dangerZone.delete")}
        onConfirm={confirmDelete}
        pending={deleteProject.isPending}
      />
    </div>
  );
}
