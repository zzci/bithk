/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput, ProjectStatus } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useCreateProject, useProjects } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ProjectFormDialog } from "./-project-form-dialog";

export const Route = createLazyFileRoute("/_app/projects/")({
  component: ProjectsListPage,
});

const STATUS_VARIANTS: Record<ProjectStatus, "default" | "outline" | "secondary"> = {
  active: "default",
  archived: "secondary",
  closed: "outline",
};

function ProjectsListPage() {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = useProjects({
    status: statusFilter === "__all__" ? undefined : (statusFilter as ProjectStatus),
    page,
  });
  const createProject = useCreateProject();

  const projects = projectsQuery.data?.data ?? [];
  const meta = projectsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const handleCreate = (values: CreateProjectInput) => {
    createProject.mutate(values, {
      onSuccess: (project) => {
        setCreateOpen(false);
        void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("page.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("list.create")}
          </Button>
        )}
      </div>

      {projectsQuery.error && <ErrorBanner message={errorMessage(projectsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex gap-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v === null)
              return;
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue>
              {(v: string) => (v === "__all__" ? t("status.all") : t(`status.${v}` as const))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("status.all")}</SelectItem>
            <SelectItem value="active">{t("status.active")}</SelectItem>
            <SelectItem value="archived">{t("status.archived")}</SelectItem>
            <SelectItem value="closed">{t("status.closed")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.col.name")}</TableHead>
              <TableHead>{t("list.col.code")}</TableHead>
              <TableHead>{t("list.col.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectsQuery.isLoading
              ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("list.loading")}</TableCell></TableRow>
              : projects.length === 0
                ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("list.empty")}</TableCell></TableRow>
                : projects.map(project => (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                    >
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{project.code ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[project.status]} className="text-xs">
                          {t(`status.${project.status}` as const)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
        {totalPages > 1 && meta && (
          <div className="flex items-center justify-between border-t px-3 py-2">
            <span className="text-xs text-muted-foreground">{t("list.total", { count: meta.total })}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
            </div>
          </div>
        )}
      </div>

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        pending={createProject.isPending}
        errorMessage={createProject.error ? errorMessage(createProject.error, t("common:common.error.operationFailed")) : null}
        onSubmit={handleCreate}
      />
    </div>
  );
}
