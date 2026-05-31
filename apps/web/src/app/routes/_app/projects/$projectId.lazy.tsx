/* eslint-disable react-refresh/only-export-components */
import type { ProjectDetailTab } from "./-project-tabs";
import { createLazyFileRoute, Outlet, useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  Clock,
  Settings,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { useProcurements } from "@/shared/lib/api/procurement";
import {
  useProject,
  useProjectIssues,
  useProjectMembers,
} from "@/shared/lib/api/projects";
import { formatDate } from "@/shared/lib/format";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { activeProjectTab, PROJECT_TAB_TO } from "./-project-tabs";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId")({
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { t } = useTranslation(["projects", "common"]);
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const { settings: settingsParam } = useSearch({ from: "/_app/projects/$projectId" });
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  // Members still feed the assignee pickers in the issue/procurement tabs, but
  // those tabs fetch their own copy now; the layout only needs them for caps.
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const project = projectQuery.data;
  const caps = useProjectCapabilities(project);

  const issuesCountQuery = useProjectIssues(caps.canViewIssues ? projectId : undefined, { limit: 1 });
  const procurementCountQuery = useProcurements(projectId, { limit: 1 }, caps.canViewProcurement);
  const issuesCount = issuesCountQuery.data?.meta.total;
  const procurementCount = procurementCountQuery.data?.meta.total;

  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  // The active tab is derived from the path (one route per tab) so back/forward
  // and detail close/back always resolve to the correct tab.
  const tab = activeProjectTab(pathname, projectId);
  const goToTab = (value: ProjectDetailTab) => {
    void navigate({ to: PROJECT_TAB_TO[value], params: { projectId } });
  };

  const [settingsOpen, setSettingsOpen] = useState(settingsParam ?? false);

  // Deep link from the project list (`?settings=true`) clears once the dialog
  // closes, keeping the current tab route in place.
  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open && settingsParam)
      void navigate({ to: ".", search: {}, replace: true });
  };

  if (projectQuery.isLoading) {
    return <p className="text-muted-foreground">{t("detail.loading")}</p>;
  }

  if (projectQuery.error || !project) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" onClick={() => void navigate({ to: "/projects" })}>
          <ArrowLeft aria-hidden="true" />
          {t("detail.back")}
        </Button>
        <ErrorBanner message={t("detail.notFound")} />
      </div>
    );
  }

  const tabCount = (n: number | undefined) => (n === undefined ? "" : ` ${n}`);

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        className="-ml-2 h-8 px-2 text-muted-foreground"
        onClick={() => void navigate({ to: "/projects" })}
      >
        <ArrowLeft aria-hidden="true" />
        {t("detail.back")}
      </Button>

      {/* Compact header — title + status, then creator/updated/tags inline on one meta row. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
            <Badge variant="secondary" className={`text-xs ${RECORD_STATUS_BADGE[project.status]}`}>
              {t(`status.${project.status}` as const)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5 shrink-0" aria-hidden="true" />
              {userNames.get(project.creatorId) ?? project.creatorId}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              {formatDate(project.updatedAt)}
            </span>
            {project.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {project.tags.map(tag => (
                  <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        {caps.canOpenSettings && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings aria-hidden="true" />
              {t("detail.settings")}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs promoted to the page's primary navigation; each tab is a route. */}
      <Tabs value={tab} onValueChange={v => v !== null && goToTab(v as ProjectDetailTab)}>
        <TabsList variant="line" className="h-auto gap-6 overflow-x-auto border-b text-base">
          <TabsTrigger value="overview" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
            {t("tabs.overview")}
          </TabsTrigger>
          {caps.canViewIssues && (
            <TabsTrigger value="issues" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
              {t("tabs.issues")}
              {tabCount(issuesCount)}
            </TabsTrigger>
          )}
          {caps.canViewProcurement && (
            <TabsTrigger value="procurement" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
              {t("tabs.procurement")}
              {tabCount(procurementCount)}
            </TabsTrigger>
          )}
          {caps.canViewFiles && (
            <TabsTrigger value="files" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
              {t("tabs.files")}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {/* The active tab route renders here. */}
      <div className="pt-1">
        <Outlet />
      </div>

      {caps.canOpenSettings && (
        <ProjectSettingsDialog
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
          project={project}
          members={members}
          userNames={userNames}
          caps={caps}
        />
      )}
    </div>
  );
}
