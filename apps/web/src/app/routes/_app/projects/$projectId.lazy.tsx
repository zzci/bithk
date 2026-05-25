/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Settings, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  useDeleteProject,
  useProject,
  useProjectMembers,
} from "@/shared/lib/api/projects";
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
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const deleteProject = useDeleteProject();

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const project = projectQuery.data;
  const caps = useProjectCapabilities(project);

  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const [tab, setTab] = useState("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (projectQuery.isLoading) {
    return <p className="text-muted-foreground">{t("detail.loading")}</p>;
  }

  if (projectQuery.error || !project) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/projects" })}>
          <ArrowLeft className="mr-1 size-4" />
          {t("detail.back")}
        </Button>
        <ErrorBanner message={t("detail.notFound")} />
      </div>
    );
  }

  const handleDelete = () => {
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        void navigate({ to: "/projects" });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/projects" })}>
          <ArrowLeft className="mr-1 size-4" />
          {t("detail.back")}
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <Badge variant="outline" className="text-xs">{t(`status.${project.status}` as const)}</Badge>
          </div>
          {project.code && <p className="text-sm text-muted-foreground">{project.code}</p>}
        </div>
        {(caps.canOpenSettings || caps.canManageProject) && (
          <div className="flex gap-2">
            {caps.canOpenSettings && (
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings className="mr-1 size-4" />
                {t("detail.settings")}
              </Button>
            )}
            {caps.canManageProject && (
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1 size-4 text-destructive" />
                {t("common:common.delete")}
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={v => v !== null && setTab(v)}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="issues">{t("tabs.issues")}</TabsTrigger>
          {caps.canViewProcurement && <TabsTrigger value="procurement">{t("tabs.procurement")}</TabsTrigger>}
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
          onOpenChange={setSettingsOpen}
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

      {/* Nested issue drawer route (`/projects/$projectId/issues/$issueId`)
          overlays this page while it stays mounted underneath. */}
      <Outlet />
    </div>
  );
}
