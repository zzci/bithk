import type { SettingRow } from "@/shared/hooks/use-settings-by-prefix";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { settingKeys } from "@/shared/lib/api/settings";
import { http } from "@/shared/lib/http";

export interface SettingsCardField {
  readonly key: string;
  readonly label: string;
  readonly sensitive: boolean;
  readonly placeholder: string;
}

interface SettingsCardProps {
  readonly title: string;
  readonly prefix: string;
  readonly fields: readonly SettingsCardField[];
  readonly settings: readonly SettingRow[];
  readonly onSaved: () => void;
  readonly onDeleted?: () => void;
}

export function SettingsCard({
  title,
  prefix,
  fields,
  settings,
  onSaved,
  onDeleted,
}: SettingsCardProps) {
  const { t } = useTranslation(["common", "settings"]);
  const initialValues = useMemo(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      const fullKey = prefix ? `${prefix}${field.key}` : field.key;
      const setting = settings.find(s => s.key === fullKey);
      initial[field.key] = setting?.value ?? "";
    }
    return initial;
  }, [fields, prefix, settings]);

  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const prevInitialRef = useRef(initialValues);
  if (prevInitialRef.current !== initialValues) {
    prevInitialRef.current = initialValues;
    setValues(initialValues);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const field of fields) {
        const val = values[field.key];
        if (val !== undefined && val !== "") {
          // Skip saving sensitive fields that still hold the masked placeholder
          if (field.sensitive && val === "******")
            continue;
          const fullKey = prefix ? `${prefix}${field.key}` : field.key;
          await http(`/settings/${fullKey}`, {
            method: "PUT",
            body: JSON.stringify({ value: val }),
          });
        }
      }
    },
    onSuccess: () => {
      // Drop every cached settings query (prefix lists + per-key details) so the
      // freshly saved values are reflected without a manual refetch.
      void queryClient.invalidateQueries({ queryKey: settingKeys.all });
      onSaved();
    },
  });

  const error = saveMutation.error instanceof Error
    ? saveMutation.error.message
    : saveMutation.isError
      ? t("common.error.saveFailed")
      : null;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold capitalize">{title}</h3>
        {onDeleted && (
          <Button variant="ghost" className="text-destructive" onClick={onDeleted}>
            <Trash2 className="mr-1 size-3" />
            {t("common.delete")}
          </Button>
        )}
      </div>

      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(field => (
          <div key={field.key} className="space-y-1">
            <Label className="text-xs">{t(field.label)}</Label>
            <Input
              type={field.sensitive ? "password" : "text"}
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          <Save className="mr-1 size-3" />
          {saveMutation.isPending ? t("settings:saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
