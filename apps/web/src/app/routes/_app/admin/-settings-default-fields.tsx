// Project default fields section of the Project Defaults tab. One setting,
// applied by the backend when a project is created without an explicit value:
//   • project.defaults.coverReferenceId  → managed server-side by the dedicated
//     /admin/project-default-cover endpoints. The cover is edited through a
//     visual picker (upload / replace / remove with a live preview), mirroring
//     the per-project cover field; the file reference id is never typed.
// New projects are always created active, so there is no default-status setting.

import { Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { FileUploadButton } from "@/shared/components/file";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import { useDefaultCover, useRemoveDefaultCover, useUploadDefaultCover } from "@/shared/lib/api/admin-default-cover";
import { errorMessage } from "@/shared/lib/errors";

export function ProjectDefaultFieldsSection() {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings:projectDefaults.defaults.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings:projectDefaults.defaults.description")}</p>
      </div>
      <DefaultCoverField />
    </section>
  );
}

// Visual default-cover picker: a live preview plus upload / replace / remove
// actions backed by the /admin/project-default-cover endpoints. Each action is
// its own mutation (type="button"), mirroring the per-project cover field.
function DefaultCoverField() {
  const { t } = useTranslation(["settings", "common"]);
  const coverQuery = useDefaultCover();
  const uploadCover = useUploadDefaultCover();
  const removeCover = useRemoveDefaultCover();

  const url = coverQuery.data?.url ?? null;
  const hasCover = coverQuery.data?.referenceId != null;
  const pending = uploadCover.isPending || removeCover.isPending;
  const error = uploadCover.error ?? removeCover.error;

  const onPick = (files: File[]) => {
    const file = files[0];
    if (file) {
      uploadCover.mutate(file, {
        onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.coverSaved")),
        onError: err => toast.error(errorMessage(err, t("common:common.error.uploadFailed"))),
      });
    }
  };

  const onRemove = () => {
    removeCover.mutate(undefined, {
      onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.coverCleared")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <div className="space-y-1.5">
      <Label>{t("settings:projectDefaults.defaults.coverLabel")}</Label>
      {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}
      <div className="flex items-center gap-4">
        <CoverImage src={url} kind="project" className="h-24 w-40 shrink-0 rounded-lg border" />
        <div className="flex flex-col gap-2">
          <FileUploadButton accept="image" disabled={pending} onSelect={onPick}>
            <Button type="button" variant="outline" disabled={pending}>
              <Upload aria-hidden="true" />
              {hasCover ? t("settings:projectDefaults.defaults.coverReplace") : t("settings:projectDefaults.defaults.coverUpload")}
            </Button>
          </FileUploadButton>
          {hasCover && (
            <Button type="button" variant="outline" disabled={pending} onClick={onRemove}>
              <Trash2 className="text-destructive" aria-hidden="true" />
              {t("settings:projectDefaults.defaults.coverRemove")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings:projectDefaults.defaults.coverHint")}</p>
    </div>
  );
}
