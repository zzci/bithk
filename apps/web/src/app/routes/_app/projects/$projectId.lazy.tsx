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
import { FavoriteToggle } from "@/shared/components/favorite-toggle";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useFavoriteSet, useToggleFavorite } from "@/shared/lib/api/favorites";
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

// Shared trigger styling for the detail tab-nav (line variant): muted resting
// state that goes solid + bold on the active route. Extracted so all four tabs
// stay in lockstep instead of repeating the class string per trigger.
const TAB_TRIGGER_CLASS
  = "px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground";

export const Route = createLazyFileRoute("/_app/projects/$projectId")({
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { t } = useTranslation(["projects", "common"]);
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  // `strict: false` reads the ship segment from whichever child is mounted: the
  // `from/$shipId` route supplies it (entered from a ship), all other tab routes
  // leave it undefined. Drives the back button's target + label below.
  const { shipId: fromShipId } = useParams({ strict: false });
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
  const favorites = useFavoriteSet();
  const toggleFavorite = useToggleFavorite();

  // Use the same `limit: 5` as the overview tab's "latest" queries so the query
  // keys coincide and TanStack Query dedupes them into one request per resource
  // instead of firing a separate count-only request (F8). Only `meta.total` is
  // read here.
  const issuesCountQuery = useProjectIssues(caps.canViewIssues ? projectId : undefined, { limit: 5 });
  const procurementCountQuery = useProcurements(projectId, { limit: 5 }, caps.canViewProcurement);
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

  // Back button returns to the originating ship when the project was opened from
  // one (`/projects/$projectId/from/$shipId`), otherwise to the project list.
  const goBack = () => {
    if (fromShipId)
      void navigate({ to: "/ships/$shipId", params: { shipId: fromShipId } });
    else
      void navigate({ to: "/projects" });
  };
  const backLabel = fromShipId ? t("detail.backToShip") : t("detail.back");

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
        <Button variant="ghost" onClick={goBack}>
          <ArrowLeft aria-hidden="true" />
          {backLabel}
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
        onClick={goBack}
      >
        <ArrowLeft aria-hidden="true" />
        {backLabel}
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
        <div className="flex shrink-0 items-center gap-2">
          <FavoriteToggle
            favorited={favorites.has("project", project.id)}
            pending={toggleFavorite.isPending}
            onToggle={willFavorite => toggleFavorite.mutate({ targetType: "project", id: project.id, favorite: willFavorite })}
          />
          {caps.canOpenSettings && (
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings aria-hidden="true" />
              {t("detail.settings")}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs promoted to the page's primary navigation; each tab is a route. */}
      <Tabs value={tab} onValueChange={v => v !== null && goToTab(v as ProjectDetailTab)}>
        <TabsList variant="line" className="h-auto gap-6 overflow-x-auto text-base">
          <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>
            {t("tabs.overview")}
          </TabsTrigger>
          {caps.canViewIssues && (
            <TabsTrigger value="issues" className={TAB_TRIGGER_CLASS}>
              {t("tabs.issues")}
              {tabCount(issuesCount)}
            </TabsTrigger>
          )}
          {caps.canViewProcurement && (
            <TabsTrigger value="procurement" className={TAB_TRIGGER_CLASS}>
              {t("tabs.procurement")}
              {tabCount(procurementCount)}
            </TabsTrigger>
          )}
          {caps.canViewFiles && (
            <TabsTrigger value="files" className={TAB_TRIGGER_CLASS}>
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
