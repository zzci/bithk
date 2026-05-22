// Drive page — a left view-nav sidebar (aligned with the documents page
// layout) + a main pane that renders one of the drive's primary views:
// the folder-browsing file browser, the recent/favorites/trash lists, the
// shared-with-me / shared-by-me share lists, or team directories.

/* eslint-disable react-refresh/only-export-components */
import type { DriveView } from "./-drive-sidebar";
import type { DriveEntry, TeamDirectory } from "@/shared/lib/api/drive";
import { createLazyFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Menu } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/components/ui/sheet";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { useTeamDirectory } from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";

import { DriveEntryListView } from "./-drive-entry-list";
import { DriveSidebar } from "./-drive-sidebar";
import { FileBrowser } from "./-file-browser";
import { FilePreviewDialog } from "./-file-preview-dialog";
import { ShareDialog } from "./-share-dialog";
import { PublicLinksList, ReceivedSharesList, SentSharesList } from "./-share-lists";
import { ManageMembersButton, TeamDirectoryList } from "./-team-directory-list";

export const Route = createLazyFileRoute("/_app/portal/drive")({
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

  const [activeView, setActiveView] = useState<DriveView>("my-files");
  const [activeDir, setActiveDir] = useState<TeamDirectory | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();

  // Page-level dialog targets, driven by the file browser / list callbacks.
  const [shareEntry, setShareEntry] = useState<DriveEntry | null>(null);
  const [previewEntry, setPreviewEntry] = useState<DriveEntry | null>(null);

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
    if (view !== "team-directories")
      setActiveDir(null);
    setSidebarOpen(false);
  };

  const sidebarProps = { activeView, onSelect: selectView } as const;

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
              size="icon-sm"
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
              activeDir={activeDir}
              onOpenDir={setActiveDir}
              onShareEntry={setShareEntry}
              onPreviewEntry={setPreviewEntry}
            />
          </div>
        </main>
      </div>

      {shareEntry && (
        <ShareDialog
          entry={shareEntry}
          open
          onOpenChange={open => !open && setShareEntry(null)}
        />
      )}
      {previewEntry && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          onOpenChange={open => !open && setPreviewEntry(null)}
        />
      )}
    </TooltipProvider>
  );
}

interface ViewCallbacks {
  readonly onShareEntry: (entry: DriveEntry) => void;
  readonly onPreviewEntry: (entry: DriveEntry) => void;
}

function DriveViewContent({
  view,
  userId,
  activeDir,
  onOpenDir,
  onShareEntry,
  onPreviewEntry,
}: ViewCallbacks & {
  readonly view: DriveView;
  readonly userId: string | null;
  readonly activeDir: TeamDirectory | null;
  readonly onOpenDir: (dir: TeamDirectory | null) => void;
}) {
  const { t } = useTranslation("drive");

  if (!userId)
    return null;

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
          <ReceivedSharesList />
        </div>
      );

    case "shared-by-me":
      return <SharedByMe />;

    case "team-directories":
      return activeDir
        ? (
            <TeamDirectoryView
              directory={activeDir}
              onBack={() => onOpenDir(null)}
              onShareEntry={onShareEntry}
              onPreviewEntry={onPreviewEntry}
            />
          )
        : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <TeamDirectoryList onOpenDirectory={onOpenDir} />
            </div>
          );

    default:
      return null;
  }
}

const SHARE_TYPES = ["direct", "public_link"] as const;
type OutgoingShareType = typeof SHARE_TYPES[number];

function SharedByMe() {
  const { t } = useTranslation("drive");
  // One list at a time, switched by share type, instead of two stacked lists.
  const [shareType, setShareType] = useState<OutgoingShareType>("direct");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-0.5 self-start rounded-lg bg-muted/50 p-0.5">
        {SHARE_TYPES.map(type => (
          <button
            key={type}
            type="button"
            onClick={() => setShareType(type)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              shareType === type
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`share.type.${type}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {shareType === "direct" ? <SentSharesList /> : <PublicLinksList />}
      </div>
    </div>
  );
}

function TeamDirectoryView({
  directory,
  onBack,
  onShareEntry,
  onPreviewEntry,
}: ViewCallbacks & {
  readonly directory: TeamDirectory;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation("drive");
  // Re-fetch the directory so the role gate reflects the latest membership.
  const dirQuery = useTeamDirectory(directory.id);
  const current = dirQuery.data ?? directory;
  const canManage = current.role === "admin" || current.role === "editor";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("page.team.back")}
        </Button>
        <span className="min-w-0 truncate text-sm font-medium">{current.name}</span>
        {current.role === "admin" && (
          <span className="ml-auto">
            <ManageMembersButton directory={current} />
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FileBrowser
          ownerType="team_directory"
          ownerId={directory.id}
          canManage={canManage}
          rootLabel={current.name}
          onShareEntry={onShareEntry}
          onPreviewEntry={onPreviewEntry}
        />
      </div>
    </div>
  );
}
