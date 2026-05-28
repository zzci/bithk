/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput, ProjectView } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/shared/components/cover-image";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
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
  useCreateProject,
  useProject,
  useProjectMembers,
  useProjects,
  useTags,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate } from "@/shared/lib/format";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { useAuthStore } from "@/shared/stores/auth";
import { ProjectFormDialog } from "./-project-form-dialog";
import { projectsFilterToQuery } from "./-project-form-logic";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/")({
  component: ProjectsListPage,
});

function ProjectsListPage() {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [filter, setFilter] = useState<string>("__active__");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);

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
    <div className="space-y-6">
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

      {projectsQuery.error && <ErrorBanner message={errorMessage(projectsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("list.filterByTag")}</span>
          {[
            { key: "__active__", label: t("status.active"), count: activeCount },
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
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("list.searchPlaceholder")}
            className="pl-8"
            aria-label={t("list.searchPlaceholder")}
          />
        </div>
      </div>

      {projectsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : visibleProjects.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : <ProjectsGrid projects={visibleProjects} isAdmin={isAdmin} openProject={openProject} openSettings={setSettingsProjectId} />}

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
        availableTags={tags.map(tag => tag.name)}
        onSubmit={handleCreate}
      />

      <ListSettingsDialog
        projectId={settingsProjectId}
        onClose={() => setSettingsProjectId(null)}
      />
    </div>
  );
}

// Loads the selected project (with capabilities), its members, and user names
// on demand so the settings dialog can open over the list without navigating
// into the project detail page.
function ListSettingsDialog({
  projectId,
  onClose,
}: {
  readonly projectId: string | null;
  readonly onClose: () => void;
}) {
  const projectQuery = useProject(projectId ?? undefined);
  const membersQuery = useProjectMembers(projectId ?? undefined);
  const usersQuery = useVisibleUsers();
  const project = projectQuery.data;
  const caps = useProjectCapabilities(project);

  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  if (!projectId || !project || !caps.canOpenSettings)
    return null;

  return (
    <ProjectSettingsDialog
      open
      onOpenChange={open => !open && onClose()}
      project={project}
      members={membersQuery.data ?? []}
      userNames={userNames}
      caps={caps}
    />
  );
}

function ProjectsGrid({
  projects,
  isAdmin,
  openProject,
  openSettings,
}: {
  readonly projects: readonly ProjectView[];
  readonly isAdmin: boolean;
  readonly openProject: (projectId: string) => void;
  readonly openSettings: (projectId: string) => void;
}) {
  const { t } = useTranslation("projects");

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          <CoverImage src={project.coverImageUrl} kind="project" className="h-28 w-full" />
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="line-clamp-2">{project.name}</CardTitle>
              <div className="flex shrink-0 items-center gap-1">
                {project.status === "archived" && (
                  <Badge variant="secondary" className={`text-xs ${RECORD_STATUS_BADGE[project.status]}`}>
                    {t(`status.${project.status}` as const)}
                  </Badge>
                )}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("list.openSettings")}
                    onClick={(event) => {
                      event.stopPropagation();
                      openSettings(project.id);
                    }}
                  >
                    <Settings aria-hidden="true" />
                  </Button>
                )}
              </div>
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
