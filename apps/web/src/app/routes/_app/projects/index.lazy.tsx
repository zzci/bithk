/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput, ProjectStatus, ProjectView } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CalendarClock,
  FolderKanban,
  LayoutGrid,
  List,
  Plus,
  Search,
  Tag as TagIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useCreateProject, useProjects, useTags } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate } from "@/shared/lib/format";
import { useAuthStore } from "@/shared/stores/auth";
import { ProjectFormDialog } from "./-project-form-dialog";
import { projectsFilterToQuery } from "./-project-form-logic";
import { StatCard, StatStrip } from "./-project-stats";

export const Route = createLazyFileRoute("/_app/projects/")({
  component: ProjectsListPage,
});

const STATUS_VARIANTS: Record<ProjectStatus, "default" | "outline" | "secondary"> = {
  active: "default",
  archived: "secondary",
};

type ViewMode = "grid" | "list";

function ProjectsListPage() {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [filter, setFilter] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const projectsQuery = useProjects({ ...projectsFilterToQuery(filter), page });
  const activeCountQuery = useProjects({ status: "active" });
  const archivedCountQuery = useProjects({ status: "archived" });
  const tagsQuery = useTags();
  const createProject = useCreateProject();

  const tags = tagsQuery.data ?? [];
  const meta = projectsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const activeCount = activeCountQuery.data?.meta.total;
  const archivedCount = archivedCountQuery.data?.meta.total;
  const totalCount = activeCount !== undefined && archivedCount !== undefined
    ? activeCount + archivedCount
    : undefined;
  const dash = (n: number | undefined) => (n === undefined ? "-" : n);

  const visibleProjects = useMemo(() => {
    const all = projectsQuery.data?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q)
      return all;
    return all.filter(p =>
      p.name.toLowerCase().includes(q)
      || (p.code?.toLowerCase().includes(q) ?? false)
      || (p.description?.toLowerCase().includes(q) ?? false),
    );
  }, [projectsQuery.data, search]);

  const handleCreate = (values: CreateProjectInput) => {
    createProject.mutate(values, {
      onSuccess: (project) => {
        setCreateOpen(false);
        void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
      },
    });
  };

  const openProject = (projectId: string) => {
    void navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("page.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t("list.create")}
          </Button>
        )}
      </div>

      <StatStrip>
        <StatCard label={t("list.kpi.total")} value={dash(totalCount)} icon={FolderKanban} />
        <StatCard label={t("list.kpi.active")} value={dash(activeCount)} />
        <StatCard label={t("list.kpi.archived")} value={dash(archivedCount)} tone="muted" />
        <StatCard label={t("list.kpi.tags")} value={tags.length} icon={TagIcon} />
      </StatStrip>

      {projectsQuery.error && <ErrorBanner message={errorMessage(projectsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("list.searchPlaceholder")}
            className="pl-8"
            aria-label={t("list.searchPlaceholder")}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1" aria-label={t("list.viewMode")}>
          <Button
            type="button"
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            aria-pressed={viewMode === "grid"}
            aria-label={t("list.viewGrid")}
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            aria-pressed={viewMode === "list"}
            aria-label={t("list.viewList")}
            onClick={() => setViewMode("list")}
          >
            <List aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "__all__", label: t("list.tagAll"), count: totalCount },
          { key: "__archived__", label: t("status.archived"), count: archivedCount },
          ...tags.map(tag => ({ key: tag.id, label: tag.name, count: undefined })),
        ].map(opt => (
          <Button
            key={opt.key}
            size="sm"
            variant={filter === opt.key ? "default" : "outline"}
            className="h-8 rounded-full"
            aria-pressed={filter === opt.key}
            onClick={() => {
              setFilter(opt.key);
              setPage(1);
            }}
          >
            {opt.label}
            {opt.count !== undefined && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{opt.count}</Badge>
            )}
          </Button>
        ))}
      </div>

      {projectsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : visibleProjects.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : viewMode === "grid"
            ? <ProjectsGrid projects={visibleProjects} openProject={openProject} />
            : <ProjectsTable projects={visibleProjects} openProject={openProject} />}

      {totalPages > 1 && meta && (
        <div className="flex items-center justify-between pt-2">
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

function ProjectsGrid({
  projects,
  openProject,
}: {
  readonly projects: readonly ProjectView[];
  readonly openProject: (projectId: string) => void;
}) {
  const { t } = useTranslation("projects");

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map(project => (
        <Card
          key={project.id}
          size="sm"
          role="button"
          tabIndex={0}
          className="cursor-pointer transition-all hover:shadow-md hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => openProject(project.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openProject(project.id);
            }
          }}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="line-clamp-2">{project.name}</CardTitle>
              <Badge variant={STATUS_VARIANTS[project.status]} className="shrink-0 text-xs">
                {t(`status.${project.status}` as const)}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {project.code && <span className="font-mono">{project.code}</span>}
              {project.code && <span className="text-muted-foreground/40">/</span>}
              <span>{formatDate(project.updatedAt)}</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
              {project.description || t("overview.noDescription")}
            </p>
            <div className="grid grid-cols-2 gap-2 border-y py-2 text-xs">
              <div>
                <div className="text-muted-foreground">{t("list.card.status")}</div>
                <div className="font-medium">{t(`status.${project.status}` as const)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t("list.card.updated")}</div>
                <div className="font-medium">{formatDate(project.updatedAt)}</div>
              </div>
            </div>
            {project.tags.length > 0
              ? (
                  <div className="flex flex-wrap gap-1">
                    {project.tags.slice(0, 4).map(tag => (
                      <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                    ))}
                    {project.tags.length > 4 && (
                      <Badge variant="outline" className="text-xs">
                        {t("list.moreTags", { count: project.tags.length - 4 })}
                      </Badge>
                    )}
                  </div>
                )
              : <span className="text-xs text-muted-foreground">{t("overview.noTags")}</span>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProjectsTable({
  projects,
  openProject,
}: {
  readonly projects: readonly ProjectView[];
  readonly openProject: (projectId: string) => void;
}) {
  const { t } = useTranslation("projects");

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("list.col.name")}</TableHead>
            <TableHead>{t("list.col.code")}</TableHead>
            <TableHead>{t("list.col.status")}</TableHead>
            <TableHead>{t("field.tags")}</TableHead>
            <TableHead>{t("list.card.updated")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map(project => (
            <TableRow
              key={project.id}
              className="cursor-pointer"
              onClick={() => openProject(project.id)}
            >
              <TableCell>
                <div className="max-w-md">
                  <div className="font-medium">{project.name}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">
                    {project.description || t("overview.noDescription")}
                  </div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{project.code || "-"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[project.status]} className="text-xs">
                  {t(`status.${project.status}` as const)}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex max-w-xs flex-wrap gap-1">
                  {project.tags.length === 0
                    ? <span className="text-xs text-muted-foreground">{t("overview.noTags")}</span>
                    : project.tags.slice(0, 3).map(tag => (
                        <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                      ))}
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock aria-hidden="true" />
                  {formatDate(project.updatedAt)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
