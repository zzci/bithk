/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  Settings,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { useProcurements } from "@/shared/lib/api/procurement";
import {
  useDeleteProject,
  useProject,
  useProjectIssues,
  useProjectMembers,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { FileBrowser } from "../-file-browser";
import { ProjectIssuesTab } from "./-project-issues-tab";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { ProjectProcurementTab } from "./-project-procurement-tab";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId")({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { t } = useTranslation(["projects", "common"]);
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const { settings: settingsParam } = useSearch({ from: "/_app/projects/$projectId" });
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const deleteProject = useDeleteProject();

  // Members no longer have a tab, but they still feed the assignee pickers in
  // the issues and procurement tabs, so keep loading them.
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const project = projectQuery.data;
  const caps = useProjectCapabilities(project);

  const issuesCountQuery = useProjectIssues(projectId, { limit: 1 });
  const procurementCountQuery = useProcurements(projectId, { limit: 1 }, caps.canViewProcurement);
  const issuesCount = issuesCountQuery.data?.meta.total;
  const procurementCount = procurementCountQuery.data?.meta.total;

  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const [tab, setTab] = useState("overview");
  const [settingsOpen, setSettingsOpen] = useState(settingsParam ?? false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Deep link from the project list (`?settings=true`) clears once the dialog closes.
  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open && settingsParam)
      void navigate({ to: "/projects/$projectId", params: { projectId }, search: {}, replace: true });
  };

  if (projectQuery.isLoading) {
    return <p className="text-muted-foreground">{t("detail.loading")}</p>;
  }

  if (projectQuery.error || !project) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/projects" })}>
          <ArrowLeft aria-hidden="true" />
          {t("detail.back")}
        </Button>
        <ErrorBanner message={t("detail.notFound")} />
      </div>
    );
  }

  const handleDelete = () => {
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        toast.success(t("toast.projectDeleted"));
        setDeleteOpen(false);
        void navigate({ to: "/projects" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, t("common:common.error.deleteFailed")));
      },
    });
  };

  const handleCopyCode = async () => {
    if (!project.code)
      return;
    try {
      await navigator.clipboard.writeText(project.code);
      toast.success(t("detail.codeCopied"));
    }
    catch {
      toast.error(t("detail.copyFailed"));
    }
  };

  const tabCount = (n: number | undefined) => (n === undefined ? "" : ` ${n}`);

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2 text-muted-foreground"
        onClick={() => void navigate({ to: "/projects" })}
      >
        <ArrowLeft aria-hidden="true" />
        {t("detail.back")}
      </Button>

      {/* Compact title row — replaces the old hero card. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
          <Badge variant="secondary" className={`text-xs ${RECORD_STATUS_BADGE[project.status]}`}>
            {t(`status.${project.status}` as const)}
          </Badge>
          {project.code && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 font-mono text-xs text-muted-foreground"
              aria-label={t("detail.copyCode")}
              onClick={() => void handleCopyCode()}
            >
              {project.code}
              <Copy aria-hidden="true" className="size-3" />
            </Button>
          )}
        </div>
        {(caps.canOpenSettings || caps.canManageProject) && (
          <div className="flex shrink-0 gap-2">
            {caps.canOpenSettings && (
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings aria-hidden="true" />
                {t("detail.settings")}
              </Button>
            )}
            {caps.canManageProject && (
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="text-destructive" aria-hidden="true" />
                {t("common:common.delete")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Tabs promoted to the page's primary navigation. */}
      <Tabs value={tab} onValueChange={v => v !== null && setTab(v)}>
        <TabsList variant="line" className="h-auto gap-6 overflow-x-auto border-b text-base">
          <TabsTrigger value="overview" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
            {t("tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="issues" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
            {t("tabs.issues")}
            {tabCount(issuesCount)}
          </TabsTrigger>
          {caps.canViewProcurement && (
            <TabsTrigger value="procurement" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
              {t("tabs.procurement")}
              {tabCount(procurementCount)}
            </TabsTrigger>
          )}
          <TabsTrigger value="files" className="px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground">
            {t("tabs.files")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-6">
          <ProjectOverviewTab
            project={project}
            userNames={userNames}
            caps={caps}
            onOpenTab={setTab}
          />
        </TabsContent>

        <TabsContent value="issues" className="pt-6">
          <ProjectIssuesTab
            projectId={project.id}
            members={members}
            userNames={userNames}
            canManage={caps.has("issue.manage")}
          />
        </TabsContent>

        {caps.canViewProcurement && (
          <TabsContent value="procurement" className="pt-6">
            <ProjectProcurementTab
              projectId={project.id}
              members={members}
              userNames={userNames}
              canManage={caps.canManageProcurement}
            />
          </TabsContent>
        )}

        <TabsContent value="files" className="pt-6">
          {/* -mx-4 cancels the drive surface's internal px-4 gutter so file rows
              align flush with the other tabs' content (the layout main has ≥16px
              horizontal padding, so this never overflows). */}
          <div className="-mx-4 h-[calc(100svh-18rem)] min-h-[24rem]">
            <FileBrowser
              ownerType="project"
              ownerId={project.id}
              canManage
              rootLabel={project.name}
              showTitle={false}
              showSearch={false}
            />
          </div>
        </TabsContent>
      </Tabs>

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

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("delete.title")}
        description={t("delete.confirm", { name: project.name })}
        pending={deleteProject.isPending}
        onConfirm={handleDelete}
      />

      <Outlet />
    </div>
  );
}
