/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
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
  useUpdateProject,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { FileBrowser } from "../-file-browser";
import { ProjectFormDialog } from "./-project-form-dialog";
import { ProjectIssuesTab } from "./-project-issues-tab";
import { ProjectMembersTab } from "./-project-members-tab";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { ProjectProcurementTab } from "./-project-procurement-tab";
import { useProjectRole } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/portal/projects/$projectId")({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { t } = useTranslation(["projects", "common"]);
  const { projectId } = useParams({ from: "/_app/portal/projects/$projectId" });
  const navigate = useNavigate();

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const role = useProjectRole(members);

  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const project = projectQuery.data;

  if (projectQuery.isLoading) {
    return <p className="text-muted-foreground">{t("detail.loading")}</p>;
  }

  if (projectQuery.error || !project) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/portal/projects" })}>
          <ArrowLeft className="mr-1 size-4" />
          {t("detail.back")}
        </Button>
        <ErrorBanner message={t("detail.notFound")} />
      </div>
    );
  }

  const handleUpdate = (values: CreateProjectInput) => {
    updateProject.mutate({ id: project.id, ...values }, {
      onSuccess: () => setEditOpen(false),
    });
  };

  const handleDelete = () => {
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        void navigate({ to: "/portal/projects" });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/portal/projects" })}>
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
        {role.isPm && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 size-4" />
              {t("common:common.edit")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1 size-4 text-destructive" />
              {t("common:common.delete")}
            </Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={v => v !== null && setTab(v)}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="issues">{t("tabs.issues")}</TabsTrigger>
          {role.canViewProcurement && <TabsTrigger value="procurement">{t("tabs.procurement")}</TabsTrigger>}
          <TabsTrigger value="files">{t("tabs.files")}</TabsTrigger>
          <TabsTrigger value="members">{t("tabs.members")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ProjectOverviewTab project={project} members={members} userNames={userNames} />
        </TabsContent>

        <TabsContent value="issues" className="pt-4">
          <ProjectIssuesTab projectId={project.id} members={members} userNames={userNames} />
        </TabsContent>

        {role.canViewProcurement && (
          <TabsContent value="procurement" className="pt-4">
            <ProjectProcurementTab
              projectId={project.id}
              members={members}
              userNames={userNames}
              canManage={role.isPm}
            />
          </TabsContent>
        )}

        <TabsContent value="files" className="pt-4">
          <div className="h-[calc(100svh-18rem)] min-h-[24rem]">
            <FileBrowser
              ownerType="project"
              ownerId={project.id}
              canManage={role.role === "pm" || role.role === "member"}
              rootLabel={project.name}
            />
          </div>
        </TabsContent>

        <TabsContent value="members" className="pt-4">
          <ProjectMembersTab
            projectId={project.id}
            members={members}
            userNames={userNames}
            canManage={role.isPm}
          />
        </TabsContent>
      </Tabs>

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        initial={project}
        pending={updateProject.isPending}
        errorMessage={updateProject.error ? errorMessage(updateProject.error, t("common:common.error.saveFailed")) : null}
        onSubmit={handleUpdate}
      />

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("delete.title")}
        description={t("delete.confirm", { name: project.name })}
        pending={deleteProject.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
