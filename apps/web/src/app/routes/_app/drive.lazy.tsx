// Drive page — a left view-nav sidebar (aligned with the documents page
// layout) + a main pane that renders one of the drive's primary views:
// the folder-browsing file browser, the recent/favorites/trash lists, the
// shared-with-me / shared-by-me share lists, or team directories.

/* eslint-disable react-refresh/only-export-components */
import type { DriveView } from "./-drive-sidebar";
import type { DriveEntry, TeamDirectory } from "@/shared/lib/api/drive";
import type { ProjectView } from "@/shared/lib/api/projects";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { FilePreviewDialog } from "@/shared/components/file";
import { useShare } from "@/shared/components/share";
import { Button } from "@/shared/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/components/ui/sheet";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { isUniverSheetEntry } from "@/shared/lib/api/drive";
import { useProject } from "@/shared/lib/api/projects";
import { useAuthStore } from "@/shared/stores/auth";

import { DriveEntryListView } from "./-drive-entry-list";
import { DriveSidebar } from "./-drive-sidebar";
import { FileBrowser } from "./-file-browser";
import { OutgoingSharesList, ReceivedSharesList } from "./-share-lists";

// Univer (and the heavy spreadsheet engine) ships in its own async chunk: the
// editor dialog is the sole `@univerjs` importer and is loaded lazily so the
// engine is fetched only when a sheet is opened, never in the drive bundle.
const UniverSheetEditorDialog = lazy(() => import("./-univer-sheet-editor-dialog"));

export const Route = createLazyFileRoute("/_app/drive")({
  component: DrivePage,
});

const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 420;
const SIDEBAR_WIDTH_DEFAULT = 224;
const SIDEBAR_WIDTH_KEY = "drive.sidebarWidth";

function clampWidth(n: number) {
  if (!Number.isFinite(n))
    return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
}

function useSidebarWidth() {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined")
      return SIDEBAR_WIDTH_DEFAULT;
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return clampWidth(raw ? Number.parseInt(raw, 10) : SIDEBAR_WIDTH_DEFAULT);
  });
  const setAndPersist = useCallback((next: number) => {
    const v = clampWidth(next);
    setWidth(v);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(v));
      }
      catch {
        // no-op: width still applied for this session.
      }
    }
  }, []);
  return [width, setAndPersist] as const;
}

function DrivePage() {
  const { t } = useTranslation("drive");
  const user = useAuthStore(s => s.user);
  const { openShare } = useShare();

  const [activeView, setActiveView] = useState<DriveView | null>("my-files");
  const [activeTeamDir, setActiveTeamDir] = useState<TeamDirectory | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectView | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();

  // Page-level dialog targets, driven by the file browser / list callbacks.
  const [previewEntry, setPreviewEntry] = useState<DriveEntry | null>(null);
  const [sheetEntry, setSheetEntry] = useState<DriveEntry | null>(null);
  const shareEntry = useCallback(
    (entry: DriveEntry) => openShare({ resourceType: "drive_entry", resourceId: entry.id, name: entry.name }),
    [openShare],
  );
  const [previewEditing, setPreviewEditing] = useState(false);
  const [sheetEditing, setSheetEditing] = useState(false);
  // Single open-routing chokepoint for every drive list (file browser, recent,
  // favorites, share lists — they all funnel through here). Univer spreadsheets
  // open the state-driven editor dialog (closing stays in the current folder);
  // everything else uses the preview viewer. `edit` starts the viewer in edit
  // mode (used after creating a blank file so creation reuses the editor).
  const openPreview = useCallback((entry: DriveEntry, edit = false) => {
    if (isUniverSheetEntry(entry)) {
      setSheetEntry(entry);
      setSheetEditing(edit);
      return;
    }
    setPreviewEntry(entry);
    setPreviewEditing(edit);
  }, []);

  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (mv: MouseEvent) => setSidebarWidth(startWidth + (mv.clientX - startX));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth, setSidebarWidth]);

  const selectView = (view: DriveView) => {
    setActiveView(view);
    setActiveTeamDir(null);
    setActiveProject(null);
    setSidebarOpen(false);
  };

  const selectTeamDir = (directory: TeamDirectory) => {
    setActiveTeamDir(directory);
    setActiveView(null);
    setActiveProject(null);
    setSidebarOpen(false);
  };

  const selectProject = (project: ProjectView) => {
    setActiveProject(project);
    setActiveView(null);
    setActiveTeamDir(null);
    setSidebarOpen(false);
  };

  const sidebarProps = {
    activeView,
    onSelect: selectView,
    activeTeamDirId: activeTeamDir?.id ?? null,
    onSelectTeamDir: selectTeamDir,
    activeProjectId: activeProject?.id ?? null,
    onSelectProject: selectProject,
    onOpenEntry: openPreview,
  } as const;

  return (
    <TooltipProvider delay={50}>
      <div className="relative -mx-4 -my-3 flex h-[calc(100svh-3rem-1px)] min-w-0 flex-col overflow-hidden md:-mx-6 md:-my-4 md:h-svh md:flex-row">
        {/* Desktop sidebar — inline column at md+. */}
        <aside
          style={{ width: sidebarWidth }}
          className="hidden md:flex md:shrink-0 md:flex-col md:overflow-hidden md:border-r md:border-border md:bg-muted/30"
        >
          <DriveSidebar {...sidebarProps} />
        </aside>
        {/* Drag handle overlaying the sidebar/main boundary. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("page.title")}
          onMouseDown={startSidebarResize}
          style={{ left: `${sidebarWidth - 2}px` }}
          className="absolute inset-y-0 z-20 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-border md:block md:active:bg-border"
        />

        {/* Mobile sidebar — slide-in Sheet from the left. */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" showCloseButton={false} className="flex w-[85vw] max-w-sm flex-col gap-0 bg-background p-0">
            <SheetTitle className="sr-only">{t("page.title")}</SheetTitle>
            <SheetDescription className="sr-only">{t("page.title")}</SheetDescription>
            <DriveSidebar {...sidebarProps} />
          </SheetContent>
        </Sheet>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Mobile-only sidebar toggle; on desktop the surface renders its own
              title so no separate header bar is needed. */}
          <div className="flex h-[45px] shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              title={t("page.title")}
            >
              <Menu className="size-4" />
            </Button>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <DriveViewContent
              view={activeView}
              userId={user?.id ?? null}
              activeTeamDir={activeTeamDir}
              activeProject={activeProject}
              onShareEntry={shareEntry}
              onPreviewEntry={openPreview}
            />
          </div>
        </main>
      </div>

      {previewEntry && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          initialEditing={previewEditing}
          onOpenChange={open => !open && setPreviewEntry(null)}
        />
      )}

      {sheetEntry && (
        <Suspense fallback={null}>
          <UniverSheetEditorDialog
            entry={sheetEntry}
            open
            initialEditing={sheetEditing}
            onOpenChange={open => !open && setSheetEntry(null)}
          />
        </Suspense>
      )}
    </TooltipProvider>
  );
}

interface ViewCallbacks {
  readonly onShareEntry: (entry: DriveEntry) => void;
  readonly onPreviewEntry: (entry: DriveEntry, edit?: boolean) => void;
}

function DriveViewContent({
  view,
  userId,
  activeTeamDir,
  activeProject,
  onShareEntry,
  onPreviewEntry,
}: ViewCallbacks & {
  readonly view: DriveView | null;
  readonly userId: string | null;
  readonly activeTeamDir: TeamDirectory | null;
  readonly activeProject: ProjectView | null;
}) {
  const { t } = useTranslation("drive");

  if (!userId)
    return null;

  // A selected project takes over the main pane and reuses the file browser
  // surface scoped to the project (ownerType="project").
  if (activeProject) {
    return (
      <ProjectFileBrowser
        key={activeProject.id}
        project={activeProject}
        onShareEntry={onShareEntry}
        onPreviewEntry={onPreviewEntry}
      />
    );
  }

  // A selected team directory takes over the main pane and reuses the file
  // browser surface directly — no intermediate list.
  if (activeTeamDir) {
    const canManage = activeTeamDir.role === "admin" || activeTeamDir.role === "editor";
    return (
      <FileBrowser
        key={activeTeamDir.id}
        ownerType="team_directory"
        ownerId={activeTeamDir.id}
        canManage={canManage}
        rootLabel={activeTeamDir.name}
        onShareEntry={onShareEntry}
        onPreviewEntry={onPreviewEntry}
      />
    );
  }

  switch (view) {
    case "my-files":
      return (
        <FileBrowser
          ownerType="user"
          ownerId={userId}
          rootLabel={t("sidebar.myFiles")}
          onShareEntry={onShareEntry}
          onPreviewEntry={onPreviewEntry}
        />
      );

    case "recent":
    case "favorites":
    case "trash":
      return (
        <div className="min-h-0 flex-1 overflow-auto">
          <DriveEntryListView source={view} userId={userId} onPreviewEntry={onPreviewEntry} />
        </div>
      );

    case "shared-with-me":
      return (
        <div className="min-h-0 flex-1 overflow-auto">
          <ReceivedSharesList onPreviewEntry={onPreviewEntry} />
        </div>
      );

    case "shared-by-me":
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <OutgoingSharesList onPreviewEntry={onPreviewEntry} />
        </div>
      );

    default:
      return null;
  }
}

// A project's files reuse the shared FileBrowser scoped to ownerType="project".
// The project detail carries the caller's effective capabilities; manage
// affordances are gated on `files.manage` (read-only until the detail loads — a
// safe default). The parent keys this by project id so switching projects
// resets the folder navigation.
function ProjectFileBrowser({
  project,
  onShareEntry,
  onPreviewEntry,
}: ViewCallbacks & {
  readonly project: ProjectView;
}) {
  const detail = useProject(project.id);
  const canManage = detail.data?.capabilities?.includes("files.manage") ?? false;
  return (
    <FileBrowser
      ownerType="project"
      ownerId={project.id}
      canManage={canManage}
      rootLabel={project.name}
      onShareEntry={onShareEntry}
      onPreviewEntry={onPreviewEntry}
    />
  );
}
