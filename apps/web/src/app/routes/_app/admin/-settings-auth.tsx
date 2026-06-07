import type { SettingsCardField } from "@/shared/components/forms/settings-card";
import { useTranslation } from "react-i18next";
import { SettingsCard } from "@/shared/components/forms/settings-card";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useSettingsByPrefix } from "@/shared/hooks/use-settings-by-prefix";

const SESSION_FIELDS: readonly SettingsCardField[] = [
  { key: "session.max_age", label: "settings:auth.fieldSessionMaxAge", sensitive: false, placeholder: "86400" },
];

export function AuthSettingsTab() {
  const { t } = useTranslation(["common", "settings"]);
  const { settings, loading, error, refetch } = useSettingsByPrefix("session.");

  return (
    <div className="space-y-6 pt-4">
      {error && <ErrorBanner message={error} />}

      {loading
        ? <EmptyHint>{t("common.loading")}</EmptyHint>
        : (
            <div>
              <h2 className="text-lg font-semibold">{t("settings:auth.sessionTitle")}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{t("settings:auth.sessionDescription")}</p>
              <SettingsCard
                title={t("settings:auth.sessionTitle")}
                prefix=""
                fields={SESSION_FIELDS}
                settings={settings}
                onSaved={refetch}
              />
            </div>
          )}
    </div>
  );
}
