// Cover image control for the project settings General tab. Upload / replace /
// remove a project cover. Each action is its own mutation (not part of the
// metadata form submit), so the buttons are type="button".

import type { ProjectView } from "@/shared/lib/api/projects";
import { Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import { useRemoveProjectCover, useSetProjectCover } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

export function ProjectCoverField({ project }: { readonly project: ProjectView }) {
  const { t } = useTranslation(["projects", "common"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const setCover = useSetProjectCover();
  const removeCover = useRemoveProjectCover();
  const pending = setCover.isPending || removeCover.isPending;
  const error = setCover.error ?? removeCover.error;

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setCover.mutate({ id: project.id, file }, {
        onSuccess: () => toast.success(t("toast.coverUpdated")),
        onError: err => toast.error(errorMessage(err, t("common:common.error.uploadFailed"))),
      });
    }
    event.target.value = "";
  };

  const onRemove = () => {
    removeCover.mutate(project.id, {
      onSuccess: () => toast.success(t("toast.coverRemoved")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <div className="space-y-2">
      <Label>{t("cover.label")}</Label>
      {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}
      <div className="flex items-center gap-4">
        <CoverImage src={project.coverImageUrl} kind="project" className="h-24 w-40 shrink-0 rounded-lg border" />
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <Button type="button" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            {project.coverImageUrl ? t("cover.replace") : t("cover.upload")}
          </Button>
          {project.coverImageUrl && (
            <Button type="button" variant="outline" disabled={pending} onClick={onRemove}>
              <Trash2 className="text-destructive" aria-hidden="true" />
              {t("cover.remove")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
