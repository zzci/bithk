/* eslint-disable react-refresh/only-export-components */
import type { HrTab } from "./-hr-tabs";
import { createFileRoute, Navigate, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useAuthStore } from "@/shared/stores/auth";
import { activeHrTab, HR_TAB_TO, hrTabs } from "./-hr-tabs";

export const Route = createFileRoute("/_app/hr")({
  component: HrLayout,
});

// HR is admin-only end to end (the API rejects non-admins with 403); mirror
// the `_app/admin` layout gate so non-admins never land on any HR page. The
// layout also owns the sub-module tab nav — each tab is a route, so deep
// links and browser back/forward resolve to the correct tab.
function HrLayout() {
  const { t } = useTranslation("hr");
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: s => s.location.pathname });

  if (!user || user.role !== "admin") {
    return <Navigate to="/overview" />;
  }

  const tab = activeHrTab(pathname);

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onValueChange={v => v !== null && void navigate({ to: HR_TAB_TO[v as HrTab] })}
      >
        <TabsList variant="line">
          {hrTabs().map(d => (
            <TabsTrigger key={d.value} value={d.value}>
              {t(d.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Outlet />
    </div>
  );
}
