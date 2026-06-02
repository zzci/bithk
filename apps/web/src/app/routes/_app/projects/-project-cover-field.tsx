// Cover image control for the project settings General tab. Thin wrapper around
// the shared CoverField: owns the project cover mutations + success/error toasts,
// passing resolved pending/error state and labels.

import type { ProjectView } from "@/shared/lib/api/projects";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverField } from "@/shared/components/cover-field";
import { useRemoveProjectCover, useSetProjectCover } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

export function ProjectCoverField({ project }: { readonly project: ProjectView }) {
  const { t } = useTranslation(["projects", "common"]);
  const setCover = useSetProjectCover();
  const removeCover = useRemoveProjectCover();
  const pending = setCover.isPending || removeCover.isPending;
  const error = setCover.error ?? removeCover.error;

  const onPick = (file: File) => {
    setCover.mutate({ id: project.id, file }, {
      onSuccess: () => toast.success(t("toast.coverUpdated")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.uploadFailed"))),
    });
  };

  const onRemove = () => {
    removeCover.mutate(project.id, {
      onSuccess: () => toast.success(t("toast.coverRemoved")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <CoverField
      kind="project"
      src={project.coverImageUrl}
      pending={pending}
      error={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      onPick={onPick}
      onRemove={onRemove}
      labels={{
        field: t("cover.label"),
        upload: t("cover.upload"),
        replace: t("cover.replace"),
        remove: t("cover.remove"),
      }}
    />
  );
}
