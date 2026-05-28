/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Package,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
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
import { formatDate } from "@/shared/lib/format";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { FileBrowser } from "../-file-browser";
import { ProjectIssuesTab } from "./-project-issues-tab";
import { ProjectMembersTab } from "./-project-members-tab";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { ProjectProcurementTab } from "./-project-procurement-tab";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { StatCard, StatStrip } from "./-project-stats";
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

  const count = (n: number | undefined) => (n === undefined ? "-" : n);
  const tabCount = (n: number | undefined) => (n === undefined ? "" : ` ${n}`);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label={t("detail.breadcrumb")}>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => void navigate({ to: "/projects" })}>
          {t("page.title")}
        </Button>
        <ChevronRight aria-hidden="true" />
        <span className="truncate font-medium text-foreground">{project.name}</span>
      </nav>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
          <div className="min-h-40 overflow-hidden rounded-lg border">
            <CoverImage src={project.coverImageUrl} kind="project" className="size-full min-h-40" />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className={`text-xs ${RECORD_STATUS_BADGE[project.status]}`}>{t(`status.${project.status}` as const)}</Badge>
                  {project.code && <span className="font-mono text-xs text-muted-foreground">{project.code}</span>}
                </div>
                <h1 className="truncate text-3xl font-semibold">{project.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t("overview.creator")}
                    {": "}
                    {userNames.get(project.creatorId) ?? project.creatorId}
                  </span>
                  <span className="text-muted-foreground/40">/</span>
                  <span>
                    {t("overview.updatedAt")}
                    {": "}
                    {formatDate(project.updatedAt)}
                  </span>
                </div>
              </div>
              {(caps.canOpenSettings || caps.canManageProject) && (
                <div className="flex gap-2">
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

            {project.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {project.tags.map(tag => (
                  <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                ))}
              </div>
            )}

            <StatStrip className={caps.canViewProcurement ? "lg:grid-cols-3" : "lg:grid-cols-2"}>
              <StatCard label={t("detail.metrics.members")} value={members.length} icon={Users} />
              <StatCard label={t("detail.metrics.issues")} value={count(issuesCount)} icon={ClipboardList} />
              {caps.canViewProcurement && (
                <StatCard label={t("detail.metrics.procurement")} value={count(procurementCount)} icon={Package} />
              )}
            </StatStrip>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={v => v !== null && setTab(v)}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="issues">
            {t("tabs.issues")}
            {tabCount(issuesCount)}
          </TabsTrigger>
          {caps.canViewProcurement && (
            <TabsTrigger value="procurement">
              {t("tabs.procurement")}
              {tabCount(procurementCount)}
            </TabsTrigger>
          )}
          <TabsTrigger value="members">
            {t("tabs.members")}
            {tabCount(members.length)}
          </TabsTrigger>
          <TabsTrigger value="files">{t("tabs.files")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ProjectOverviewTab project={project} members={members} userNames={userNames} />
        </TabsContent>

        <TabsContent value="issues" className="pt-4">
          <ProjectIssuesTab projectId={project.id} members={members} userNames={userNames} />
        </TabsContent>

        {caps.canViewProcurement && (
          <TabsContent value="procurement" className="pt-4">
            <ProjectProcurementTab
              projectId={project.id}
              members={members}
              userNames={userNames}
              canManage={caps.canManageProcurement}
            />
          </TabsContent>
        )}

        <TabsContent value="members" className="pt-4">
          <ProjectMembersTab projectId={project.id} userNames={userNames} />
        </TabsContent>

        <TabsContent value="files" className="pt-4">
          <div className="h-[calc(100svh-18rem)] min-h-[24rem]">
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
