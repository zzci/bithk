// General settings section: edit the project's basic fields (name,
// description) and tags. Submits via useUpdateProject. The project code is
// read-only and surfaced in the settings dialog sidebar. Archiving/restoring
// and deleting the project live in the Danger Zone at the bottom, each guarded
// by its own confirm dialog.

import type {
  ProjectView,
  UpdateProjectInput,
} from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useDeleteProject,
  useTags,
  useUpdateProject,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { ProjectCoverField } from "./-project-cover-field";
import { ProjectTagsCombobox } from "./-project-tags-combobox";

interface ProjectSettingsGeneralProps {
  readonly project: ProjectView;
}

export function ProjectSettingsGeneral({ project }: ProjectSettingsGeneralProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  // Guard with Array.isArray (not just `?? []`): a contract-violating or
  // stale-cache non-array `data` would still reach `.map` and crash the render,
  // the same class of bug fixed for the issues list in c466cfc.
  const tagsQuery = useTags();
  const suggestions = (Array.isArray(tagsQuery.data) ? tagsQuery.data : []).map(tag => tag.name);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [tags, setTags] = useState<readonly string[]>(project.tags.map(tag => tag.name));
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  /* eslint-disable react/set-state-in-effect -- reseed when the project record
     changes (e.g. after a successful save invalidates and refetches). */
  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? "");
    setTags(project.tags.map(tag => tag.name));
  }, [project]);
  /* eslint-enable react/set-state-in-effect */

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || updateProject.isPending)
      return;
    const values: UpdateProjectInput = {
      name: name.trim(),
      status: project.status,
      description: description.trim() || null,
      tags,
    };
    updateProject.mutate({ id: project.id, ...values }, {
      onSuccess: () => toast.success(t("toast.projectUpdated")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.saveFailed"))),
    });
  };

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
      <ProjectCoverField project={project} />

      <form onSubmit={submit} className="space-y-4">
        {updateProject.error && <ErrorBanner message={errorMessage(updateProject.error, t("common:common.error.saveFailed"))} />}

        <div className="space-y-1.5">
          <Label htmlFor="settings-name">{t("field.name")}</Label>
          <Input id="settings-name" required value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-description">{t("field.description")}</Label>
          <Textarea id="settings-description" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>{t("field.tags")}</Label>
          <ProjectTagsCombobox value={tags} onChange={setTags} suggestions={suggestions} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateProject.isPending || !name.trim()}>
            {t("common:common.save")}
          </Button>
        </div>
      </form>

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
