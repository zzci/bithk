/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput, ProjectView } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { ListFilter } from "@/shared/components/list-filter";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import {
  useCreateProject,
  useProject,
  useProjectMembers,
  useProjects,
  useTags,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ProjectFormDialog } from "./-project-form-dialog";
import { projectsFilterToQuery } from "./-project-form-logic";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/")({
  component: ProjectsListPage,
});

export function ProjectsListPage() {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [filter, setFilter] = useState<string>("__active__");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  // Search runs server-side (whole-list, not page-local), so debounce the raw
  // input before it drives the query to avoid a request per keystroke.
  const debouncedSearch = useDebounce(search, 300);

  const projectsQuery = useProjects({ ...projectsFilterToQuery(filter), q: debouncedSearch.trim() || undefined, page });
  // Count chips only need `meta.total`, so request a single row instead of a
  // full 20-row page (the `limit` is part of the query key, so these stay
  // distinct from the main list query).
  const activeCountQuery = useProjects({ status: "active", limit: 1 });
  const archivedCountQuery = useProjects({ status: "archived", limit: 1 });
  const tagsQuery = useTags();
  const createProject = useCreateProject();

  const tags = tagsQuery.data ?? [];
  const meta = projectsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const activeCount = activeCountQuery.data?.meta.total;
  const archivedCount = archivedCountQuery.data?.meta.total;

  const visibleProjects = projectsQuery.data?.data ?? [];

  const handleCreate = (values: CreateProjectInput) => {
    createProject.mutate(values, {
      onSuccess: (project) => {
        toast.success(t("toast.projectCreated"));
        setCreateOpen(false);
        void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
      },
      onError: (err) => {
        toast.error(errorMessage(err, t("common:common.error.operationFailed")));
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
      </div>

      {projectsQuery.error && <ErrorBanner message={errorMessage(projectsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("field.status"),
              mode: "single",
              resident: true,
              defaultValue: "__active__",
              value: tags.some(tag => tag.id === filter) ? "__active__" : filter,
              onChange: (value) => {
                setFilter(value ?? "__active__");
                setPage(1);
              },
              options: [
                { value: "__active__", label: t("status.active"), count: activeCount },
                { value: "__archived__", label: t("status.archived"), count: archivedCount },
              ],
            },
            {
              key: "tags",
              label: t("field.tags"),
              mode: "single",
              residentCount: 5,
              value: tags.some(tag => tag.id === filter) ? filter : null,
              onChange: (value) => {
                setFilter(value ?? "__active__");
                setPage(1);
              },
              options: tags.map(tag => ({ value: tag.id, label: tag.name })),
            },
          ]}
        />
        <SearchCreateBar
          search={{
            value: search,
            onChange: (v) => {
              setSearch(v);
              setPage(1);
            },
            placeholder: t("list.searchPlaceholder"),
          }}
          {...(isAdmin ? { create: { onClick: () => setCreateOpen(true) } } : {})}
        />
      </div>

      {projectsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : visibleProjects.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : <ProjectsGrid projects={visibleProjects} isAdmin={isAdmin} openProject={openProject} openSettings={setSettingsProjectId} />}

      {totalPages > 1 && meta && (
        <PaginationFooter
          page={page}
          totalPages={totalPages}
          totalLabel={t("list.total", { count: meta.total })}
          onPrev={() => setPage(p => p - 1)}
          onNext={() => setPage(p => p + 1)}
        />
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
          className="relative cursor-pointer transition-all hover:shadow-md hover:ring-foreground/20 focus-within:ring-2 focus-within:ring-ring"
        >
          <CoverImage src={project.coverImageUrl} kind="project" seed={project.id} className="h-28 w-full" />
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              {/* The title is the single navigable control; its ::after overlay
                  stretches over the whole card so clicking anywhere (except the
                  Settings button, raised with z-10) opens the project. */}
              <CardTitle className="min-w-0">
                <Button
                  type="button"
                  variant="ghost"
                  className="line-clamp-2 h-auto whitespace-normal rounded-none px-0 text-left after:absolute after:inset-0 after:rounded-[inherit] hover:bg-transparent"
                  onClick={() => openProject(project.id)}
                >
                  {project.name}
                </Button>
              </CardTitle>
              <div className="relative z-10 flex shrink-0 items-center gap-1">
                {project.status === "archived" && (
                  <Badge variant="secondary" className="text-[10px] tracking-wide uppercase">
                    {t("status.archived")}
                  </Badge>
                )}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("list.openSettings")}
                    onClick={() => openSettings(project.id)}
                  >
                    <Settings aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {project.description?.trim() && (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
            {/* Always render the tag row so cards without tags reserve the same
                bottom space (min-h-5 matches the Badge height), keeping card
                heights and action alignment stable across the grid. */}
            <div className="flex min-h-5 flex-wrap items-center gap-1">
              {project.tags.slice(0, 3).map(tag => (
                <Badge key={tag.id} variant="secondary" className="text-[10px] font-medium">
                  {tag.name}
                </Badge>
              ))}
              {project.tags.length > 3 && (
                <span className="self-center text-[10px] font-medium text-muted-foreground">
                  {t("list.moreTags", { count: project.tags.length - 3 })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
