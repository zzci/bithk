import type { SettingsCardField } from "@/shared/components/forms/settings-card";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingsCard } from "@/shared/components/forms/settings-card";
import { Button } from "@/shared/components/ui/button";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { useBranding } from "@/shared/hooks/use-branding";
import { useSettingsByPrefix } from "@/shared/hooks/use-settings-by-prefix";
import { putSetting } from "@/shared/lib/api/settings";
import { useSendSmtpTest } from "@/shared/lib/api/smtp";

export function SmtpSettingsTab() {
  const { t } = useTranslation(["common", "settings"]);
  const { appDisplayName } = useBranding();
  const { settings, loading, error, setError, refetch } = useSettingsByPrefix("smtp.");
  const sendTest = useSendSmtpTest();
  const [testSentTo, setTestSentTo] = useState<string | null>(null);
  const smtpFields = useMemo<readonly SettingsCardField[]>(() => [
    { key: "smtp.host", label: "settings:smtp.fieldHost", sensitive: false, placeholder: "smtp.example.com" },
    { key: "smtp.port", label: "settings:smtp.fieldPort", sensitive: false, placeholder: "587" },
    { key: "smtp.username", label: "settings:smtp.fieldUsername", sensitive: false, placeholder: "user@example.com" },
    { key: "smtp.password", label: "settings:smtp.fieldPassword", sensitive: true, placeholder: "Password" },
    { key: "smtp.from_address", label: "settings:smtp.fieldFromAddress", sensitive: false, placeholder: "noreply@example.com" },
    { key: "smtp.from_name", label: "settings:smtp.fieldFromName", sensitive: false, placeholder: appDisplayName },
  ], [appDisplayName]);

  const smtpEnabled = settings.find(s => s.key === "smtp.enabled")?.value === "true";
  const smtpSecure = settings.find(s => s.key === "smtp.secure")?.value === "true";

  const writeFlag = async (key: "smtp.enabled" | "smtp.secure", checked: boolean) => {
    try {
      await putSetting(key, String(checked));
      void refetch();
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
  };

  const handleSendTest = () => {
    setError(null);
    setTestSentTo(null);
    sendTest.mutate(undefined, {
      onSuccess: (result) => {
        setTestSentTo(result.to);
        toast.success(t("settings:smtp.testSent", { to: result.to }));
      },
      onError: err => setError(err instanceof Error ? err.message : t("common.error.operationFailed")),
    });
  };

  return (
    <div className="space-y-4 pt-4">
      {error && <ErrorBanner message={error} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:smtp.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:smtp.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="smtp-toggle" className="text-sm">{t("settings:smtp.enable")}</Label>
          <Switch
            id="smtp-toggle"
            checked={smtpEnabled}
            onCheckedChange={checked => void writeFlag("smtp.enabled", checked)}
          />
        </div>
      </div>

      {loading
        ? <EmptyHint>{t("common.loading")}</EmptyHint>
        : (
            <>
              <SettingsCard
                title={t("settings:smtp.serverConfig")}
                prefix=""
                fields={smtpFields}
                settings={settings}
                onSaved={refetch}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="flex items-center gap-3">
                  <Switch
                    id="smtp-secure"
                    checked={smtpSecure}
                    aria-label={t("settings:smtp.secure")}
                    onCheckedChange={checked => void writeFlag("smtp.secure", checked)}
                  />
                  <div>
                    <Label htmlFor="smtp-secure" className="text-sm">{t("settings:smtp.secure")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings:smtp.secureHint")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {testSentTo && (
                    <span className="text-sm text-muted-foreground">{t("settings:smtp.testSent", { to: testSentTo })}</span>
                  )}
                  <Button variant="outline" onClick={handleSendTest} disabled={sendTest.isPending || !smtpEnabled}>
                    {sendTest.isPending ? t("settings:smtp.sending") : t("settings:smtp.sendTest")}
                  </Button>
                </div>
              </div>
            </>
          )}

    </div>
  );
}
