// Project default fields section of the Project Defaults tab. Two settings,
// applied by the backend when a project is created without an explicit value:
//   • project.defaults.status            → active | archived (PUT/DELETE setting)
//   • project.defaults.coverReferenceId  → managed server-side by the dedicated
//     /admin/project-default-cover endpoints. The cover is edited through a
//     visual picker (upload / replace / remove with a live preview), mirroring
//     the per-project cover field; the file reference id is never typed.

import type { ProjectStatus } from "@/shared/lib/api/projects";
import { Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useDefaultCover, useRemoveDefaultCover, useUploadDefaultCover } from "@/shared/lib/api/admin-default-cover";
import { useDeleteSetting, usePutSetting, useSetting } from "@/shared/lib/api/settings";
import { errorMessage } from "@/shared/lib/errors";

const STATUS_KEY = "project.defaults.status";
const STATUS_OPTIONS: readonly ProjectStatus[] = ["active", "archived"];

export function ProjectDefaultFieldsSection() {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings:projectDefaults.defaults.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings:projectDefaults.defaults.description")}</p>
      </div>
      <DefaultStatusField />
      <DefaultCoverField />
    </section>
  );
}

function DefaultStatusField() {
  const { t } = useTranslation(["settings", "common"]);
  const settingQuery = useSetting(STATUS_KEY);
  const putSetting = usePutSetting();
  const deleteSetting = useDeleteSetting();

  const current = settingQuery.data ?? null;
  const pending = putSetting.isPending || deleteSetting.isPending;

  const onSelect = (value: string | null) => {
    if (!value || value === current)
      return;
    putSetting.mutate({ key: STATUS_KEY, value }, {
      onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.statusSaved")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.saveFailed"))),
    });
  };

  const onClear = () => {
    deleteSetting.mutate(STATUS_KEY, {
      onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.statusCleared")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="default-status">{t("settings:projectDefaults.defaults.statusLabel")}</Label>
      <div className="flex items-center gap-2">
        <Select value={current ?? ""} onValueChange={onSelect}>
          <SelectTrigger id="default-status" className="w-48" disabled={pending}>
            <SelectValue placeholder={t("settings:projectDefaults.defaults.statusUnset")} />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(status => (
              <SelectItem key={status} value={status}>{t(`settings:projectDefaults.defaults.status_${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={pending || current === null} onClick={onClear}>
          {t("settings:projectDefaults.defaults.clear")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings:projectDefaults.defaults.statusHint")}</p>
    </div>
  );
}

// Visual default-cover picker: a live preview plus upload / replace / remove
// actions backed by the /admin/project-default-cover endpoints. Each action is
// its own mutation (type="button"), mirroring the per-project cover field.
function DefaultCoverField() {
  const { t } = useTranslation(["settings", "common"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const coverQuery = useDefaultCover();
  const uploadCover = useUploadDefaultCover();
  const removeCover = useRemoveDefaultCover();

  const url = coverQuery.data?.url ?? null;
  const hasCover = coverQuery.data?.referenceId != null;
  const pending = uploadCover.isPending || removeCover.isPending;
  const error = uploadCover.error ?? removeCover.error;

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadCover.mutate(file, {
        onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.coverSaved")),
        onError: err => toast.error(errorMessage(err, t("common:common.error.uploadFailed"))),
      });
    }
    event.target.value = "";
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
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            {hasCover ? t("settings:projectDefaults.defaults.coverReplace") : t("settings:projectDefaults.defaults.coverUpload")}
          </Button>
          {hasCover && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onRemove}>
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
