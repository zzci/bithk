/* eslint-disable react-refresh/only-export-components */
import type { HrTab } from "./-hr-tabs";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/shared/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { activeHrTab, HR_TAB_TO, hrTabs } from "./-hr-tabs";

// Same trigger styling as the project detail tab-nav
// (`projects/$projectId.lazy.tsx`): muted resting state that goes solid + bold
// on the active route.
const TAB_TRIGGER_CLASS
  = "px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground";

export const Route = createFileRoute("/_app/hr")({
  component: HrLayout,
});

// HR access is gated by the `hr` module key (PLAN-076): the generic module
// guard in `_app` redirects users without it, and the API answers their
// requests with 404. The layout owns the sub-module tab nav — each tab is a
// route, so deep links and browser back/forward resolve to the correct tab.
function HrLayout() {
  const { t } = useTranslation("hr");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: s => s.location.pathname });

  const tab = activeHrTab(pathname);

  return (
    <div className="space-y-5">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <Tabs
        value={tab}
        onValueChange={v => v !== null && void navigate({ to: HR_TAB_TO[v as HrTab] })}
      >
        <TabsList variant="line" className="h-auto gap-6 overflow-x-auto text-base">
          {hrTabs().map(d => (
            <TabsTrigger key={d.value} value={d.value} className={TAB_TRIGGER_CLASS}>
              {t(d.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="pt-1">
        <Outlet />
      </div>
    </div>
  );
}
