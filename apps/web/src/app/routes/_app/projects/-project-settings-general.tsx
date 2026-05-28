// General settings section: edit the project's basic fields (name,
// description, status) and tags. Submits via useUpdateProject. The project
// code is read-only and surfaced in the settings dialog sidebar, not here.

import type {
  ProjectStatus,
  ProjectView,
  UpdateProjectInput,
} from "@/shared/lib/api/projects";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { useUpdateProject } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { ProjectCoverField } from "./-project-cover-field";
import { TagsInput } from "./-tags-input";

const STATUSES: readonly ProjectStatus[] = ["active", "archived"];

interface ProjectSettingsGeneralProps {
  readonly project: ProjectView;
}

export function ProjectSettingsGeneral({ project }: ProjectSettingsGeneralProps) {
  const { t } = useTranslation(["projects", "common"]);
  const updateProject = useUpdateProject();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [tags, setTags] = useState<readonly string[]>(project.tags.map(tag => tag.name));

  /* eslint-disable react/set-state-in-effect -- reseed when the project record
     changes (e.g. after a successful save invalidates and refetches). */
  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? "");
    setStatus(project.status);
    setTags(project.tags.map(tag => tag.name));
  }, [project]);
  /* eslint-enable react/set-state-in-effect */

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || updateProject.isPending)
      return;
    const values: UpdateProjectInput = {
      name: name.trim(),
      status,
      description: description.trim() || null,
      tags,
    };
    updateProject.mutate({ id: project.id, ...values }, {
      onSuccess: () => toast.success(t("toast.projectUpdated")),
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
          <Label>{t("field.status")}</Label>
          <Select value={status} onValueChange={v => v !== null && setStatus(v as ProjectStatus)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) => t(`status.${v}` as const)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>{t(`status.${s}` as const)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("field.tags")}</Label>
          <TagsInput value={tags} onChange={setTags} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateProject.isPending || !name.trim()}>
            {t("common:common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
