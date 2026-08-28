/* eslint-disable react-refresh/only-export-components */
import type { CreateProjectInput, ProjectSectionKey, ProjectView } from "@/shared/lib/api/projects";
import { createLazyFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { FavoriteToggle } from "@/shared/components/favorite-toggle";
import { ListFilter } from "@/shared/components/list-filter";
import { CardGridSkeleton } from "@/shared/components/list-skeleton";
import { PageHeader } from "@/shared/components/page-header";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { TagChips, tagFilterDimension } from "@/shared/components/tags";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useFavoriteSet, useToggleFavorite } from "@/shared/lib/api/favorites";
import {
  hasSection,
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
import { mountableProjectSections, projectSectionFilterLabelKey } from "./-project-sections";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { ProjectShipIdentity } from "./-project-ship-identity";

export const Route = createLazyFileRoute("/_app/projects/")({
  component: ProjectsListPage,
});

// "All" option value for the section dimension. ListFilter needs a concrete
// string for its unset state; it never reaches the API — the `section` search
// param is simply dropped instead.
const ALL_SECTIONS = "__all__";

export function ProjectsListPage() {
  // `ships` supplies the section-filter label of the maritime sections; the
  // registry names the namespace per entry.
  const { t } = useTranslation(["projects", "ships", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");
  // The section filter lives in the URL (`/projects?section=ship-profile` is
  // the sidebar's "Ships" preset link), so it round-trips through history and
  // is shareable. Every other filter stays component state.
  const { section } = useSearch({ from: "/_app/projects/" });

  const [status, setStatus] = useState<"__active__" | "__archived__">("__active__");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  // Search runs server-side (whole-list, not page-local), so debounce the raw
  // input before it drives the query to avoid a request per keystroke.
  const debouncedSearch = useDebounce(search, 300);

  // `section` goes to the API, NOT to a client-side filter over the fetched
  // page: the list is paginated, so narrowing here would hide matches on later
  // pages and report a wrong total.
  const projectsQuery = useProjects({ ...projectsFilterToQuery(status), tagIds: selectedTagIds, q: debouncedSearch.trim() || undefined, section, page });
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

  const setSection = (next: ProjectSectionKey | null) => {
    void navigate({ to: "/projects", search: next ? { section: next } : {}, replace: true });
    setPage(1);
  };

  const tagDim = tagFilterDimension({
    tags,
    value: selectedTagIds,
    onChange: (ids) => {
      setSelectedTagIds(ids);
      setPage(1);
    },
    label: t("field.tags"),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />

      {projectsQuery.error && <ErrorBanner message={errorMessage(projectsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("field.status"),
              mode: "single",
              defaultValue: "__active__",
              value: status,
              onChange: (value) => {
                setStatus(value === "__archived__" ? "__archived__" : "__active__");
                setPage(1);
              },
              options: [
                { value: "__active__", label: t("status.active"), count: activeCount },
                { value: "__archived__", label: t("status.archived"), count: archivedCount },
              ],
            },
            {
              key: "section",
              label: t("list.sectionFilter"),
              mode: "single",
              defaultValue: ALL_SECTIONS,
              value: section ?? ALL_SECTIONS,
              onChange: value => setSection(value === null || value === ALL_SECTIONS ? null : value as ProjectSectionKey),
              options: [
                { value: ALL_SECTIONS, label: t("list.sectionAll") },
                ...mountableProjectSections().map(entry => ({
                  value: entry.key,
                  label: t(projectSectionFilterLabelKey(entry)),
                })),
              ],
            },
            ...(tagDim ? [tagDim] : []),
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
        ? <CardGridSkeleton label={t("list.loading")} />
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
  const favorites = useFavoriteSet();
  const toggleFavorite = useToggleFavorite();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map(project => (
        <Card
          key={project.id}
          size="sm"
          className="relative cursor-pointer transition-all hover:shadow-md hover:ring-foreground/20 focus-within:ring-2 focus-within:ring-ring"
        >
          <CoverImage src={project.coverImageUrl} kind="project" seed={project.id} enableLightbox className="h-28 w-full" />
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              {/* The title is the single navigable control; its ::after overlay
                  stretches over the whole card so clicking anywhere (except the
                  Settings button, raised with z-10) opens the project. */}
              <CardTitle className="min-w-0">
                <button
                  type="button"
                  className="line-clamp-2 text-left after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none"
                  onClick={() => openProject(project.id)}
                >
                  {project.name}
                </button>
              </CardTitle>
              <div className="relative z-10 flex shrink-0 items-center gap-1">
                <FavoriteToggle
                  favorited={favorites.has("project", project.id)}
                  pending={toggleFavorite.isPending && toggleFavorite.variables?.id === project.id}
                  onToggle={willFavorite => toggleFavorite.mutate({ targetType: "project", id: project.id, favorite: willFavorite })}
                />
                {project.status === "archived" && (
                  <Badge variant="secondary" className="text-2xs tracking-wide uppercase">
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
            {/* Section-aware body: a project that mounts `ship-profile` leads
                with the vessel's identity; every other project keeps the plain
                description. No `type` column exists — the sections decide. */}
            {hasSection(project, "ship-profile")
              ? <ProjectShipIdentity projectId={project.id} />
              : project.description?.trim() && (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {project.description}
                </p>
              )}
            {/* Always render the tag row so cards without tags reserve the same
                bottom space (min-h-5 matches the Badge height), keeping card
                heights and action alignment stable across the grid. */}
            <div className="flex min-h-5 flex-wrap items-center gap-1">
              <TagChips
                tags={project.tags}
                max={3}
                className="text-2xs font-medium"
                moreClassName="self-center text-2xs font-medium text-muted-foreground"
                renderMore={count => t("list.moreTags", { count })}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
