import { useTranslation } from "react-i18next";

// Shared empty state for pre-mounted HR sub-modules (approvals, payroll):
// the routes and tabs exist so the HR information architecture is fixed, but
// the features are intentionally unimplemented.
export function HrPlaceholder({ module }: { module: "approvals" | "payroll" }) {
  const { t } = useTranslation("hr");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t(`${module}.title`)}</h1>
        <p className="text-sm text-muted-foreground">{t(`${module}.description`)}</p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("placeholder.comingSoon")}</p>
      </div>
    </div>
  );
}
