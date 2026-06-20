// Currency category of the global "General" settings tab. Shows the built-in
// currency codes read-only and lets an admin add / remove custom codes. The
// merged list is what the procurement and HR forms offer; custom codes persist
// under the `app.currencies` setting via the shared currency data layer.

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { isValidCurrencyCode, useCurrencies, useSaveCustomCurrencies } from "@/shared/lib/api/currency";
import { errorMessage } from "@/shared/lib/errors";

export function CurrencySettingsSection() {
  const { t } = useTranslation(["settings", "common"]);
  const currenciesQuery = useCurrencies();
  const saveCustom = useSaveCustomCurrencies();
  const [draft, setDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const builtin = currenciesQuery.data?.builtin ?? [];
  const custom = currenciesQuery.data?.custom ?? [];

  const commit = (codes: string[], successKey: string) => {
    saveCustom.mutate(codes, {
      onSuccess: () => toast.success(t(successKey)),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const onAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const code = draft.trim().toUpperCase();
    if (!code || saveCustom.isPending)
      return;
    if (!isValidCurrencyCode(code)) {
      setFormError(t("settings:currency.invalid"));
      return;
    }
    if (builtin.includes(code) || custom.includes(code)) {
      setFormError(t("settings:currency.duplicate", { code }));
      return;
    }
    setFormError(null);
    setDraft("");
    commit([...custom, code], "settings:currency.toast.added");
  };

  const onRemove = (code: string) => {
    commit(custom.filter(c => c !== code), "settings:currency.toast.removed");
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings:currency.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings:currency.description")}</p>
      </div>

      {currenciesQuery.error && (
        <ErrorBanner message={errorMessage(currenciesQuery.error, t("common:common.error.loadFailed"))} />
      )}

      <div className="space-y-1.5">
        <Label>{t("settings:currency.builtinLabel")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {builtin.map(code => (
            <Badge key={code} variant="secondary">{code}</Badge>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("settings:currency.customLabel")}</Label>
        {custom.length === 0
          ? <p className="text-sm text-muted-foreground">{t("settings:currency.empty")}</p>
          : (
              <div className="flex flex-wrap gap-1.5">
                {custom.map(code => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pr-1 pl-2 text-sm"
                  >
                    {code}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={saveCustom.isPending}
                      aria-label={t("settings:currency.remove", { code })}
                      onClick={() => onRemove(code)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </span>
                ))}
              </div>
            )}
      </div>

      <form onSubmit={onAdd} className="space-y-1.5">
        {formError && <ErrorBanner message={formError} />}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="currency-add">{t("settings:currency.addLabel")}</Label>
            <Input
              id="currency-add"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setFormError(null);
              }}
              maxLength={3}
              placeholder={t("settings:currency.addPlaceholder")}
              className="uppercase"
            />
          </div>
          <Button type="submit" disabled={saveCustom.isPending || !draft.trim()}>
            <Plus aria-hidden="true" />
            {t("settings:currency.add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings:currency.hint")}</p>
      </form>
    </section>
  );
}
