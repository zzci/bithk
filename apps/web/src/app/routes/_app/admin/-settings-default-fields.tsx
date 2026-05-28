// Project default fields section of the Project Defaults tab. Two settings,
// applied by the backend when a project is created without an explicit value:
//   • project.defaults.status            → active | archived
//   • project.defaults.coverReferenceId  → a file reference id
// Each can be set (PUT) or cleared (DELETE). The cover is identified by its
// file reference id: the backend exposes no admin upload-to-reference endpoint,
// so this is an id field rather than an inline image picker.

import type { ProjectStatus } from "@/shared/lib/api/projects";
import { useRef, useState } from "react";
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
import { useDeleteSetting, usePutSetting, useSetting } from "@/shared/lib/api/settings";
import { errorMessage } from "@/shared/lib/errors";

const STATUS_KEY = "project.defaults.status";
const COVER_KEY = "project.defaults.coverReferenceId";
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

function DefaultCoverField() {
  const { t } = useTranslation(["settings", "common"]);
  const settingQuery = useSetting(COVER_KEY);
  const putSetting = usePutSetting();
  const deleteSetting = useDeleteSetting();

  const current = settingQuery.data ?? null;
  const pending = putSetting.isPending || deleteSetting.isPending;

  // Resync the editable field whenever the persisted value changes (initial
  // load, post-save invalidation) without an effect — mirrors SettingsCard.
  const [value, setValue] = useState(current ?? "");
  const prevCurrentRef = useRef(current);
  if (prevCurrentRef.current !== current) {
    prevCurrentRef.current = current;
    setValue(current ?? "");
  }

  const trimmed = value.trim();
  const dirty = trimmed !== (current ?? "");

  const onSave = () => {
    if (!trimmed || !dirty)
      return;
    putSetting.mutate({ key: COVER_KEY, value: trimmed }, {
      onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.coverSaved")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.saveFailed"))),
    });
  };

  const onClear = () => {
    deleteSetting.mutate(COVER_KEY, {
      onSuccess: () => toast.success(t("settings:projectDefaults.defaults.toast.coverCleared")),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="default-cover">{t("settings:projectDefaults.defaults.coverLabel")}</Label>
      {(putSetting.error || deleteSetting.error) && (
        <ErrorBanner message={errorMessage(putSetting.error ?? deleteSetting.error, t("common:common.error.operationFailed"))} />
      )}
      <div className="flex items-center gap-2">
        <Input
          id="default-cover"
          className="max-w-md font-mono"
          placeholder={t("settings:projectDefaults.defaults.coverPlaceholder")}
          value={value}
          disabled={pending}
          onChange={e => setValue(e.target.value)}
        />
        <Button size="sm" disabled={pending || !trimmed || !dirty} onClick={onSave}>
          {t("common:common.save")}
        </Button>
        <Button variant="outline" size="sm" disabled={pending || current === null} onClick={onClear}>
          {t("settings:projectDefaults.defaults.clear")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings:projectDefaults.defaults.coverHint")}</p>
    </div>
  );
}
