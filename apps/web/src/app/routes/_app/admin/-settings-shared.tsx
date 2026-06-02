// Shared building blocks for the admin settings page — types, helpers,
// and the generic `SettingsCard` form used by the Auth / SMTP tabs. The
// mix of exports (hook + helper functions + components) is intentional
// for this `-`-prefixed helper module; disable the react-refresh rule
// here so we keep the consumer count low.
/* eslint-disable react-refresh/only-export-components */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { settingKeys } from "@/shared/lib/api/settings";
import { http } from "@/shared/lib/http";

// ─── Shared types ───

export interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

// ─── Settings helpers ───

// Prefix/list query key, nested under the shared `["settings"]` namespace from
// the settings api layer so saves/deletes that invalidate the root also drop
// these list caches — the two layers can no longer diverge for the same key.
const settingsPrefixKey = (prefix: string) => [...settingKeys.all, "prefix", prefix] as const;

export function useSettingsByPrefix(prefix: string) {
  // Consumer-supplied error overlay (e.g. a failed toggle/delete) sits on top
  // of the query's own load error; cleared on refetch, matching the prior hook.
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: settingsPrefixKey(prefix),
    queryFn: async () => {
      const res = await http<{ success: boolean; data: SettingRow[] }>(`/settings?prefix=${encodeURIComponent(prefix)}`);
      return res.data;
    },
  });

  const queryRefetch = query.refetch;
  const refetch = useCallback(async () => {
    setOverrideError(null);
    await queryRefetch();
  }, [queryRefetch]);

  const error = overrideError
    ?? (query.error instanceof Error
      ? query.error.message
      : query.isError
        ? "Failed to load settings"
        : null);

  return {
    settings: query.data ?? [],
    loading: query.isPending,
    error,
    setError: setOverrideError,
    refetch,
  };
}

export async function saveSetting(key: string, value: string) {
  await http(`/settings/${key}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export async function deleteSetting(key: string) {
  await http(`/settings/${key}`, { method: "DELETE" });
}

// ─── Shared components ───

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

export function SettingsCard({
  title,
  prefix,
  fields,
  settings,
  onSaved,
  onDeleted,
}: {
  title: string;
  prefix: string;
  fields: readonly { key: string; label: string; sensitive: boolean; placeholder: string }[];
  settings: SettingRow[];
  onSaved: () => void;
  onDeleted?: () => void;
}) {
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
          await saveSetting(fullKey, val);
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

      {error && <ErrorBanner message={error} />}

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
