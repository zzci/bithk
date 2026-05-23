/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput, ProjectStatus } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useCreateProject, useProjects, useTags } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ProjectFormDialog } from "./-project-form-dialog";
import { projectsFilterToQuery } from "./-project-form-logic";

export const Route = createLazyFileRoute("/_app/projects/")({
  component: ProjectsListPage,
});

const STATUS_VARIANTS: Record<ProjectStatus, "default" | "outline" | "secondary"> = {
  active: "default",
  archived: "secondary",
};

function ProjectsListPage() {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  // A single, mutually-exclusive filter: "__all__", "__archived__" (a
  // status filter surfaced as just another chip), or a tag id.
  const [filter, setFilter] = useState<string>("__all__");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = useProjects({ ...projectsFilterToQuery(filter), page });
  const tagsQuery = useTags();
  const createProject = useCreateProject();

  const projects = projectsQuery.data?.data ?? [];
  const tags = tagsQuery.data ?? [];
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("list.filterByTag")}</span>
        {[
          { key: "__all__", label: t("list.tagAll") },
          { key: "__archived__", label: t("status.archived") },
          ...tags.map(tag => ({ key: tag.id, label: tag.name })),
        ].map(opt => (
          <Button
            key={opt.key}
            size="sm"
            variant={filter === opt.key ? "default" : "outline"}
            className="h-8 rounded-full"
            onClick={() => {
              setFilter(opt.key);
              setPage(1);
            }}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {projectsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : projects.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map(project => (
                  <Card
                    key={project.id}
                    size="sm"
                    className="cursor-pointer transition-colors hover:ring-foreground/20"
                    onClick={() => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="line-clamp-2">{project.name}</CardTitle>
                        <Badge variant={STATUS_VARIANTS[project.status]} className="shrink-0 text-xs">
                          {t(`status.${project.status}` as const)}
                        </Badge>
                      </div>
                      {project.code && <p className="text-xs text-muted-foreground">{project.code}</p>}
                    </CardHeader>
                    {project.tags.length > 0 && (
                      <CardContent>
                        <div className="flex flex-wrap gap-1">
                          {project.tags.map(tag => (
                            <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}

      {totalPages > 1 && meta && (
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">{t("list.total", { count: meta.total })}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
          </div>
        </div>
      )}

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={createProject.isPending}
        errorMessage={createProject.error ? errorMessage(createProject.error, t("common:common.error.operationFailed")) : null}
        onSubmit={handleCreate}
      />
    </div>
  );
}
