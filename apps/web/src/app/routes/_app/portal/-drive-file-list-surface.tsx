import type { LucideIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
// THE shared drive file-list surface.
//
// One encapsulated, reusable component. Every drive consumer (folder browser,
// recent/favorites collections, share lists, the file picker) renders through
// this surface and passes its data as `DisplayItem[]` plus an `actions` bag —
// the surface itself stays presentational and never touches the API client.
//
// It owns the cross-cutting list behaviour: search, type/owner/modified/source
// filters, name/modified sorting (folders first), grid|list view persisted to
// localStorage, multi-select with rubber-band drag selection, the batch bar,
// per-row "more actions" dropdowns, item right-click context menus, and the
// blank-area create context menu.
import type {
  DisplayItem,
  DriveModifiedFilter,
  DriveOwnerFilter,
  DriveSortBy,
  DriveSourceFilter,
  DriveTypeFilter,
} from "./-file-browser-types";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  FileText,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { FILE_ICONS, formatDate, formatSize } from "./-file-browser-types";

// ── Public API ──

export interface FileListAction {
  readonly key: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly variant?: "default" | "destructive";
  readonly onSelect: (item: DisplayItem) => void;
}

export interface DriveFileListCapabilities {
  readonly download?: boolean;
  readonly share?: boolean;
  readonly favorite?: boolean;
  readonly rename?: boolean;
  readonly delete?: boolean;
  readonly restore?: boolean;
  readonly batchDownload?: boolean;
  readonly batchDelete?: boolean;
  readonly batchRestore?: boolean;
  readonly navigateFolders?: boolean;
  readonly createFolder?: boolean;
  readonly upload?: boolean;
  readonly createTextFile?: boolean;
}

export interface FolderToolbarConfig {
  readonly kind: "folder";
  readonly variant?: "full" | "compact";
  readonly ownerType: "user" | "team" | "project";
  readonly folderPath: readonly { readonly id: string | null; readonly name: string }[];
  readonly showCreateActions?: boolean;
  readonly onNavigateToBreadcrumb: (index: number) => void;
  readonly onImportFromDrive?: () => void;
}

export interface CollectionToolbarConfig {
  readonly kind: "collection";
  readonly titleKey: string;
  readonly emptyIcon: LucideIcon;
  readonly emptyTitleKey: string;
  readonly emptyDescKey: string;
  readonly headerAction?: ReactNode;
  readonly allowViewModeSwitch?: boolean;
}

export type ToolbarConfig = FolderToolbarConfig | CollectionToolbarConfig;

export interface DriveFileListSurfaceActions {
  readonly onRefresh: () => void;
  readonly onNavigateToFolder: (entryId: string, folderName: string) => void;
  readonly onDownload: (fileId: string, fileName: string) => void;
  readonly onShare: (fileId: string, name: string) => void;
  readonly onDelete: (entryId: string) => void;
  readonly onBatchDelete: (entryIds: Set<string>) => void;
  readonly onRestore?: (entryId: string) => void;
  readonly onBatchRestore?: (entryIds: Set<string>) => void;
  readonly onPreview: (item: DisplayItem) => void;
  readonly onRename: (item: DisplayItem) => void;
  readonly onFavoriteChange: (item: DisplayItem, favorite: boolean) => void;
  readonly onCreateFolder?: () => void;
  readonly onUploadClick?: () => void;
  readonly onCreateTextFile?: (kind: "markdown" | "text") => void;
  readonly getCustomActions?: (item: DisplayItem) => FileListAction[];
}

export interface DriveFileListSurfaceProps {
  readonly items: readonly DisplayItem[];
  readonly loading: boolean;
  readonly toolbar: ToolbarConfig;
  readonly capabilities?: DriveFileListCapabilities;
  readonly actions: DriveFileListSurfaceActions;
  readonly initialViewMode?: "grid" | "list";
  readonly viewModeStorageKey?: string;
  readonly banner?: ReactNode;
}

const DEFAULT_CAPABILITIES: Required<DriveFileListCapabilities> = {
  download: true,
  share: true,
  favorite: true,
  rename: true,
  delete: true,
  restore: false,
  batchDownload: true,
  batchDelete: true,
  batchRestore: false,
  navigateFolders: true,
  createFolder: false,
  upload: false,
  createTextFile: false,
};

function getInitialViewMode(storageKey: string | undefined, fallback: "grid" | "list"): "grid" | "list" {
  if (!storageKey || typeof window === "undefined")
    return fallback;
  const stored = window.localStorage.getItem(storageKey);
  return stored === "grid" || stored === "list" ? stored : fallback;
}

export function DriveFileListSurface({
  items,
  loading,
  toolbar,
  capabilities,
  actions,
  initialViewMode = "list",
  viewModeStorageKey,
  banner,
}: DriveFileListSurfaceProps) {
  const { t } = useTranslation("drive");
  const user = useAuthStore(s => s.user);
  const resolvedCapabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };

  const [viewMode, setViewMode] = useState<"grid" | "list">(() => getInitialViewMode(viewModeStorageKey, initialViewMode));
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<DriveSortBy>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<DriveOwnerFilter>("all");
  const [modifiedFilter, setModifiedFilter] = useState<DriveModifiedFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<DriveSourceFilter>("all");

  const itemIdsKey = useMemo(() => items.map(item => item.id).join("\0"), [items]);
  const visibleSelectedIds = useMemo(() => {
    const itemIds = new Set(itemIdsKey ? itemIdsKey.split("\0") : []);
    return new Set([...selectedIds].filter(id => itemIds.has(id)));
  }, [itemIdsKey, selectedIds]);
  const effectiveSelectionMode = selectionMode && visibleSelectedIds.size > 0;

  useEffect(() => {
    if (viewModeStorageKey && typeof window !== "undefined")
      window.localStorage.setItem(viewModeStorageKey, viewMode);
  }, [viewMode, viewModeStorageKey]);

  const handleSelectionModeChange = (mode: boolean) => {
    setSelectionMode(mode);
    if (!mode)
      setSelectedIds(new Set());
  };

  const filteredItems = useMemo(() => {
    let nextItems = [...items];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      nextItems = nextItems.filter(item => item.name.toLowerCase().includes(query));
    }

    if (typeFilter !== "all") {
      nextItems = nextItems.filter((item) => {
        if (typeFilter === "folders")
          return item.isFolder;
        if (typeFilter === "files")
          return !item.isFolder;
        return item.type === typeFilter;
      });
    }

    if (ownerFilter === "me" && user)
      nextItems = nextItems.filter(item => item.ownerId === user.id);

    if (modifiedFilter !== "all") {
      const now = new Date();
      const start = new Date(now);
      if (modifiedFilter === "today") {
        start.setHours(0, 0, 0, 0);
      }
      else {
        const days = modifiedFilter === "7d" ? 7 : 30;
        start.setDate(now.getDate() - days);
      }
      nextItems = nextItems.filter(item => new Date(item.modified) >= start);
    }

    nextItems.sort((a, b) => {
      if (a.isFolder !== b.isFolder)
        return a.isFolder ? -1 : 1;
      const cmp = sortBy === "modified"
        ? new Date(a.modified).getTime() - new Date(b.modified).getTime()
        : a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return nextItems;
  }, [items, modifiedFilter, ownerFilter, searchQuery, sortBy, sortDir, typeFilter, user]);

  const handleSortChange = (field: DriveSortBy) => {
    if (sortBy === field) {
      setSortDir(prev => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "modified" ? "desc" : "asc");
  };

  const handleBatchDownload = () => {
    filteredItems
      .filter(item => visibleSelectedIds.has(item.id) && !item.isFolder && item.fileId)
      .forEach(item => actions.onDownload(item.fileId!, item.name));
  };

  const handleBatchDelete = () => actions.onBatchDelete(new Set(visibleSelectedIds));
  const handleBatchRestore = () => actions.onBatchRestore?.(new Set(visibleSelectedIds));

  const filterBar = (
    <DriveFilterBar
      typeFilter={typeFilter}
      ownerFilter={ownerFilter}
      modifiedFilter={modifiedFilter}
      sourceFilter={sourceFilter}
      onTypeFilterChange={setTypeFilter}
      onOwnerFilterChange={setOwnerFilter}
      onModifiedFilterChange={setModifiedFilter}
      onSourceFilterChange={setSourceFilter}
    />
  );

  const renderCollectionToolbar = (config: CollectionToolbarConfig) => (
    <div className="flex shrink-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2 text-lg">
          <span className="min-w-0 truncate font-medium text-foreground">{t(config.titleKey)}</span>
          <button
            type="button"
            onClick={actions.onRefresh}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("browser.refresh")}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {config.headerAction}
          <div className="relative w-[360px] max-w-[42vw] shrink-0">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={t("browser.searchPlaceholder")}
              className="h-9 pl-9 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="scrollbar-hide overflow-x-auto px-4 pb-1">
        <div className="flex min-h-10 w-max min-w-full items-center gap-3">
          {filterBar}
          <div className="ml-auto flex min-h-9 shrink-0 items-center justify-end gap-1">
            {effectiveSelectionMode
              ? (
                  <BatchControls
                    count={visibleSelectedIds.size}
                    capabilities={resolvedCapabilities}
                    hasRestore={Boolean(actions.onBatchRestore)}
                    onBatchDownload={handleBatchDownload}
                    onBatchRestore={handleBatchRestore}
                    onBatchDelete={handleBatchDelete}
                    onCancel={() => handleSelectionModeChange(false)}
                  />
                )
              : (
                  (config.allowViewModeSwitch ?? true) && (
                    <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
                  )
                )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderEmptyState = (config: CollectionToolbarConfig) => {
    const EmptyIcon = config.emptyIcon;
    return (
      <div className="flex h-full min-h-[360px] w-full flex-1 items-center justify-center">
        <div className="text-center">
          <EmptyIcon className="mx-auto mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">{t(config.emptyTitleKey)}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t(config.emptyDescKey)}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {toolbar.kind === "folder"
        ? (
            <FileToolbar
              variant={toolbar.variant}
              ownerType={toolbar.ownerType}
              folderPath={toolbar.folderPath}
              loading={loading}
              viewMode={viewMode}
              selectionMode={effectiveSelectionMode}
              selectedCount={visibleSelectedIds.size}
              searchQuery={searchQuery}
              filterBar={filterBar}
              capabilities={resolvedCapabilities}
              hasRestore={Boolean(actions.onBatchRestore)}
              onNavigateToBreadcrumb={toolbar.onNavigateToBreadcrumb}
              onRefresh={actions.onRefresh}
              onSearchQueryChange={setSearchQuery}
              onViewModeChange={setViewMode}
              onCancelSelection={() => handleSelectionModeChange(false)}
              onBatchDownload={handleBatchDownload}
              onBatchRestore={handleBatchRestore}
              onBatchDelete={handleBatchDelete}
              showCreateActions={toolbar.showCreateActions}
              onCreateFolder={actions.onCreateFolder}
              onUploadClick={actions.onUploadClick}
              onImportFromDrive={toolbar.onImportFromDrive}
            />
          )
        : renderCollectionToolbar(toolbar)}

      {banner}

      <div className="flex min-h-0 flex-1">
        {!loading && filteredItems.length === 0 && toolbar.kind === "collection"
          ? renderEmptyState(toolbar)
          : (
              <FileList
                displayItems={filteredItems}
                loading={loading}
                viewMode={viewMode}
                sortBy={sortBy}
                sortDir={sortDir}
                selectionMode={effectiveSelectionMode}
                selectedIds={visibleSelectedIds}
                canDelete={resolvedCapabilities.delete}
                canDownload={resolvedCapabilities.download}
                canNavigateFolders={resolvedCapabilities.navigateFolders}
                canRename={resolvedCapabilities.rename}
                canShare={resolvedCapabilities.share}
                canFavorite={resolvedCapabilities.favorite}
                canRestore={resolvedCapabilities.restore}
                onSortChange={handleSortChange}
                onSelectionModeChange={handleSelectionModeChange}
                onSelectedIdsChange={setSelectedIds}
                onNavigateToFolder={actions.onNavigateToFolder}
                onDownload={actions.onDownload}
                onShare={actions.onShare}
                onDelete={actions.onDelete}
                onBatchDelete={handleBatchDelete}
                onRestore={actions.onRestore}
                onBatchRestore={handleBatchRestore}
                onPreview={actions.onPreview}
                onRename={actions.onRename}
                onFavoriteChange={actions.onFavoriteChange}
                onCreateFolder={resolvedCapabilities.createFolder ? actions.onCreateFolder : undefined}
                onUploadClick={resolvedCapabilities.upload ? actions.onUploadClick : undefined}
                onCreateTextFile={resolvedCapabilities.createTextFile ? actions.onCreateTextFile : undefined}
                getCustomActions={actions.getCustomActions}
              />
            )}
      </div>
    </div>
  );
}

// ── Shared toolbar controls ──

function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  readonly viewMode: "grid" | "list";
  readonly onViewModeChange: (mode: "grid" | "list") => void;
}) {
  const { t } = useTranslation("drive");
  return (
    <div className="mr-1 flex items-center gap-1 rounded-md border bg-background p-0.5">
      <Button
        variant="ghost"
        size="icon"
        className={cn("size-8", viewMode === "grid" && "bg-accent")}
        onClick={() => onViewModeChange("grid")}
        aria-label={t("browser.viewGrid")}
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("size-8", viewMode === "list" && "bg-accent")}
        onClick={() => onViewModeChange("list")}
        aria-label={t("browser.viewList")}
      >
        <List className="size-4" />
      </Button>
    </div>
  );
}

function BatchControls({
  count,
  capabilities,
  hasRestore,
  onBatchDownload,
  onBatchRestore,
  onBatchDelete,
  onCancel,
}: {
  readonly count: number;
  readonly capabilities: Required<DriveFileListCapabilities>;
  readonly hasRestore: boolean;
  readonly onBatchDownload: () => void;
  readonly onBatchRestore: () => void;
  readonly onBatchDelete: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("drive");
  return (
    <>
      <span className="mr-1 min-w-0 text-sm font-medium whitespace-nowrap">
        {t("browser.selectedCount", { count })}
      </span>
      {capabilities.batchDownload && (
        <Button variant="ghost" size="icon" className="size-9" onClick={onBatchDownload} aria-label={t("browser.action.download")}>
          <Download className="size-4" />
        </Button>
      )}
      {capabilities.batchRestore && hasRestore && (
        <Button variant="ghost" size="icon" className="size-9" onClick={onBatchRestore} aria-label={t("browser.action.restore")}>
          <RotateCcw className="size-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="size-9" onClick={onCancel} aria-label={t("common.cancel")}>
        <X className="size-4" />
      </Button>
      {capabilities.batchDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-destructive hover:text-destructive"
          onClick={onBatchDelete}
          aria-label={t("browser.deleteSelected")}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </>
  );
}

// ── Folder toolbar (breadcrumb + create + view/search + batch) ──

interface FileToolbarProps {
  readonly variant?: "full" | "compact" | undefined;
  readonly ownerType: "user" | "team" | "project";
  readonly folderPath: readonly { readonly id: string | null; readonly name: string }[];
  readonly loading: boolean;
  readonly viewMode: "grid" | "list";
  readonly selectionMode: boolean;
  readonly selectedCount: number;
  readonly searchQuery: string;
  readonly filterBar: ReactNode;
  readonly capabilities: Required<DriveFileListCapabilities>;
  readonly hasRestore: boolean;
  readonly onNavigateToBreadcrumb: (index: number) => void;
  readonly onRefresh: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onViewModeChange: (mode: "grid" | "list") => void;
  readonly onCancelSelection: () => void;
  readonly onBatchDownload: () => void;
  readonly onBatchRestore: () => void;
  readonly onBatchDelete: () => void;
  readonly showCreateActions?: boolean | undefined;
  readonly onCreateFolder?: (() => void) | undefined;
  readonly onUploadClick?: (() => void) | undefined;
  readonly onImportFromDrive?: (() => void) | undefined;
}

function FileToolbar({
  variant = "full",
  ownerType,
  folderPath,
  loading,
  viewMode,
  selectionMode,
  selectedCount,
  searchQuery,
  filterBar,
  capabilities,
  hasRestore,
  onNavigateToBreadcrumb,
  onRefresh,
  onSearchQueryChange,
  onViewModeChange,
  onCancelSelection,
  onBatchDownload,
  onBatchRestore,
  onBatchDelete,
  showCreateActions = true,
  onCreateFolder,
  onUploadClick,
  onImportFromDrive,
}: FileToolbarProps) {
  const { t } = useTranslation("drive");
  const hasSelection = selectionMode && selectedCount > 0;

  return (
    <div className="flex shrink-0 flex-col bg-background">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2 text-lg">
          {folderPath.map((crumb, i) => (
            <div key={crumb.id ?? "root"} className="flex min-w-0 items-center gap-2">
              {i > 0 && <span className="text-muted-foreground/60">/</span>}
              <button
                type="button"
                onClick={() => onNavigateToBreadcrumb(i)}
                className={cn(
                  "min-w-0 truncate transition-colors",
                  i === folderPath.length - 1
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {crumb.name}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onRefresh}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("browser.refresh")}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </button>
        </div>

        <div className="relative w-[360px] max-w-[42vw] shrink-0">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => onSearchQueryChange(e.target.value)}
            placeholder={t("browser.searchPlaceholder")}
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      <div className="scrollbar-hide overflow-x-auto px-4 pb-1">
        <div className="flex min-h-10 w-max min-w-full items-center gap-3">
          <div className="flex shrink-0 items-center gap-2">
            {variant === "full" && filterBar}
          </div>

          <div className="ml-auto flex min-h-9 shrink-0 items-center justify-end gap-1">
            {hasSelection
              ? (
                  <BatchControls
                    count={selectedCount}
                    capabilities={capabilities}
                    hasRestore={hasRestore}
                    onBatchDownload={onBatchDownload}
                    onBatchRestore={onBatchRestore}
                    onBatchDelete={onBatchDelete}
                    onCancel={onCancelSelection}
                  />
                )
              : (
                  <>
                    {variant === "full" && (
                      <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
                    )}
                    {showCreateActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={(
                            <Button variant="ghost" size="icon" className="size-9" aria-label={t("browser.create")} />
                          )}
                        >
                          <Plus className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          {onCreateFolder && (
                            <DropdownMenuItem onClick={onCreateFolder}>
                              <FolderPlus className="mr-2 size-4" />
                              {t("browser.newFolder")}
                            </DropdownMenuItem>
                          )}
                          {onUploadClick && (
                            <DropdownMenuItem onClick={onUploadClick}>
                              <Upload className="mr-2 size-4" />
                              {t("browser.upload")}
                            </DropdownMenuItem>
                          )}
                          {ownerType === "project" && onImportFromDrive && (
                            <DropdownMenuItem onClick={onImportFromDrive}>
                              <FolderInput className="mr-2 size-4" />
                              {t("browser.importFromDrive")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </>
                )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filter bar (type / owner / modified / source) ──

interface DriveFilterBarProps {
  readonly typeFilter: DriveTypeFilter;
  readonly ownerFilter: DriveOwnerFilter;
  readonly modifiedFilter: DriveModifiedFilter;
  readonly sourceFilter: DriveSourceFilter;
  readonly onTypeFilterChange: (value: DriveTypeFilter) => void;
  readonly onOwnerFilterChange: (value: DriveOwnerFilter) => void;
  readonly onModifiedFilterChange: (value: DriveModifiedFilter) => void;
  readonly onSourceFilterChange: (value: DriveSourceFilter) => void;
}

function DriveFilterBar({
  typeFilter,
  ownerFilter,
  modifiedFilter,
  sourceFilter,
  onTypeFilterChange,
  onOwnerFilterChange,
  onModifiedFilterChange,
  onSourceFilterChange,
}: DriveFilterBarProps) {
  const { t } = useTranslation("drive");

  const typeFilterLabels: Record<DriveTypeFilter, string> = {
    all: t("browser.filter.all"),
    folders: t("browser.filter.folders"),
    files: t("browser.filter.files"),
    pdf: "PDF",
    image: t("browser.filter.images"),
    document: t("browser.filter.documents"),
    spreadsheet: t("browser.filter.spreadsheets"),
  };

  const typeFilterIcons: Record<DriveTypeFilter, ReactNode> = {
    all: null,
    folders: FILE_ICONS.folder("size-4"),
    files: FILE_ICONS.file("size-4"),
    pdf: FILE_ICONS.pdf("size-4"),
    image: FILE_ICONS.image("size-4"),
    document: FILE_ICONS.document("size-4"),
    spreadsheet: FILE_ICONS.spreadsheet("size-4"),
  };

  const ownerFilterLabels: Record<DriveOwnerFilter, string> = {
    all: t("browser.filter.all"),
    me: t("browser.filter.ownedByMe"),
  };

  const modifiedFilterLabels: Record<DriveModifiedFilter, string> = {
    "all": t("browser.filter.all"),
    "today": t("browser.filter.modifiedToday"),
    "7d": t("browser.filter.modified7Days"),
    "30d": t("browser.filter.modified30Days"),
  };

  const sourceFilterLabels: Record<DriveSourceFilter, string> = {
    all: t("browser.filter.all"),
    current: t("browser.filter.currentSource"),
  };

  const filterMenu = <T extends string>(
    label: string,
    value: T,
    options: { value: T; label: string; icon?: ReactNode }[],
    onChange: (value: T) => void,
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 shrink-0 rounded-md px-4 text-sm font-medium whitespace-nowrap",
              value !== "all" && "bg-accent",
            )}
          />
        )}
      >
        <span>{label}</span>
        {value !== "all" && (
          <span className="text-muted-foreground">
            {options.find(option => option.value === value)?.label}
          </span>
        )}
        {value !== "all" && options.find(option => option.value === value)?.icon}
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {options.map(option => (
            <DropdownMenuItem key={option.value} className="gap-3" onClick={() => onChange(option.value)}>
              {options.some(item => item.icon) && (
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {option.icon}
                </span>
              )}
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex shrink-0 items-center gap-2">
      {filterMenu(
        t("browser.filter.typeLabel"),
        typeFilter,
        (Object.keys(typeFilterLabels) as DriveTypeFilter[]).map(value => ({
          value,
          label: typeFilterLabels[value],
          icon: typeFilterIcons[value],
        })),
        onTypeFilterChange,
      )}
      {filterMenu(
        t("browser.filter.people"),
        ownerFilter,
        (Object.keys(ownerFilterLabels) as DriveOwnerFilter[]).map(value => ({ value, label: ownerFilterLabels[value] })),
        onOwnerFilterChange,
      )}
      {filterMenu(
        t("browser.filter.modified"),
        modifiedFilter,
        (Object.keys(modifiedFilterLabels) as DriveModifiedFilter[]).map(value => ({ value, label: modifiedFilterLabels[value] })),
        onModifiedFilterChange,
      )}
      {filterMenu(
        t("browser.filter.source"),
        sourceFilter,
        (Object.keys(sourceFilterLabels) as DriveSourceFilter[]).map(value => ({ value, label: sourceFilterLabels[value] })),
        onSourceFilterChange,
      )}
    </div>
  );
}

// ── Inner list / grid ──

const LIST_SKELETON_KEYS = Array.from({ length: 8 }, (_, index) => `list-skeleton-${index}`);
const GRID_SKELETON_KEYS = Array.from({ length: 12 }, (_, index) => `grid-skeleton-${index}`);

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragSelectionState {
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  baseSelectedIds: Set<string>;
  hasDragged: boolean;
}

interface FileListProps {
  readonly displayItems: readonly DisplayItem[];
  readonly loading: boolean;
  readonly viewMode: "grid" | "list";
  readonly sortBy: DriveSortBy;
  readonly sortDir: "asc" | "desc";
  readonly selectionMode: boolean;
  readonly selectedIds: Set<string>;
  readonly canDelete?: boolean;
  readonly canDownload?: boolean;
  readonly canNavigateFolders?: boolean;
  readonly canRename?: boolean;
  readonly canShare?: boolean;
  readonly canFavorite?: boolean;
  readonly canRestore?: boolean;
  readonly onSortChange: (field: DriveSortBy) => void;
  readonly onSelectionModeChange: (mode: boolean) => void;
  readonly onSelectedIdsChange: (ids: Set<string>) => void;
  readonly onNavigateToFolder: (entryId: string, folderName: string) => void;
  readonly onDownload: (fileId: string, fileName: string) => void;
  readonly onShare: (fileId: string, name: string) => void;
  readonly onDelete: (entryId: string) => void;
  readonly onRestore?: ((entryId: string) => void) | undefined;
  readonly onBatchRestore?: (() => void) | undefined;
  readonly onBatchDelete: () => void;
  readonly onPreview: (item: DisplayItem) => void;
  readonly onRename: (item: DisplayItem) => void;
  readonly onFavoriteChange: (item: DisplayItem, favorite: boolean) => void;
  readonly onCreateFolder?: (() => void) | undefined;
  readonly onUploadClick?: (() => void) | undefined;
  readonly onCreateTextFile?: ((kind: "markdown" | "text") => void) | undefined;
  readonly getCustomActions?: ((item: DisplayItem) => FileListAction[]) | undefined;
}

const LIST_COLUMNS_CLASS = "grid-cols-[minmax(280px,1.6fr)_minmax(160px,0.7fr)_minmax(160px,0.75fr)_88px_160px] @max-[980px]:grid-cols-[minmax(260px,1.45fr)_minmax(150px,0.7fr)_minmax(136px,0.55fr)_40px] @max-[760px]:grid-cols-[minmax(280px,1fr)_112px_40px]";

function FileList({
  displayItems,
  loading,
  viewMode,
  sortBy,
  sortDir,
  selectionMode,
  selectedIds,
  canDelete = true,
  canDownload = true,
  canNavigateFolders = true,
  canRename = true,
  canShare = true,
  canFavorite = true,
  canRestore = false,
  onSortChange,
  onSelectionModeChange,
  onSelectedIdsChange,
  onNavigateToFolder,
  onDownload,
  onShare,
  onDelete,
  onRestore,
  onBatchRestore,
  onBatchDelete,
  onPreview,
  onRename,
  onFavoriteChange,
  onCreateFolder,
  onUploadClick,
  onCreateTextFile,
  getCustomActions,
}: FileListProps) {
  const { t } = useTranslation("drive");
  const containerRef = useRef<HTMLDivElement>(null);
  const itemNodeMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const suppressNextBlankClickRef = useRef(false);
  const dragSelectionRef = useRef<DragSelectionState | null>(null);
  const removeDragListenersRef = useRef<(() => void) | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null);

  const blankContextMenu = onCreateTextFile || onCreateFolder || onUploadClick
    ? (
        <ContextMenuContent>
          {onUploadClick && (
            <ContextMenuItem onClick={onUploadClick}>
              <Upload className="mr-2 size-4" />
              {t("browser.upload")}
            </ContextMenuItem>
          )}
          {onCreateFolder && (
            <ContextMenuItem onClick={onCreateFolder}>
              <FolderPlus className="mr-2 size-4" />
              {t("browser.newFolder")}
            </ContextMenuItem>
          )}
          {onCreateTextFile && (
            <>
              <ContextMenuItem onClick={() => onCreateTextFile("text")}>
                <FileText className="mr-2 size-4" />
                {t("browser.newTextFile")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCreateTextFile("markdown")}>
                <FileText className="mr-2 size-4" />
                {t("browser.newMarkdownFile")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )
    : null;

  const sortIcon = (field: DriveSortBy) => {
    if (sortBy !== field)
      return null;
    const Icon = sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-sky-200 text-sky-700 dark:bg-sky-900/70 dark:text-sky-300">
        <Icon className="size-3.5" />
      </span>
    );
  };

  const getOwnerLabel = (item: DisplayItem) => item.owner?.trim() || "—";

  const itemIcon = (item: DisplayItem, className: string) => {
    if (item.isFolder && item.ownerType === "team")
      return <FolderOpen className={`${className} text-sky-600/80 dark:text-sky-400/80`} />;
    return FILE_ICONS[item.type](className);
  };

  const thumbnailPreview = (item: DisplayItem) => (
    <div className="flex size-full items-center justify-center bg-background">
      {itemIcon(item, "size-14")}
    </div>
  );

  const openItem = (item: DisplayItem) => {
    if (item.isFolder && canNavigateFolders)
      onNavigateToFolder(item.id, item.name);
    else if (item.fileId)
      onPreview(item);
  };

  const getRangeIds = (targetId: string) => {
    const anchorId = lastSelectedId ?? displayItems.find(item => selectedIds.has(item.id))?.id ?? targetId;
    const anchorIndex = displayItems.findIndex(item => item.id === anchorId);
    const targetIndex = displayItems.findIndex(item => item.id === targetId);
    if (anchorIndex < 0 || targetIndex < 0)
      return [targetId];
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return displayItems.slice(start, end + 1).map(item => item.id);
  };

  const handleItemClick = (event: ReactMouseEvent, item: DisplayItem) => {
    event.stopPropagation();
    onSelectionModeChange(true);

    if (event.shiftKey) {
      onSelectedIdsChange(new Set(getRangeIds(item.id)));
      setLastSelectedId(item.id);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      const nextSelectedIds = new Set(selectedIds);
      if (nextSelectedIds.has(item.id))
        nextSelectedIds.delete(item.id);
      else
        nextSelectedIds.add(item.id);
      onSelectedIdsChange(nextSelectedIds);
      onSelectionModeChange(nextSelectedIds.size > 0);
      setLastSelectedId(item.id);
      return;
    }

    onSelectedIdsChange(new Set([item.id]));
    setLastSelectedId(item.id);
  };

  const handleItemDoubleClick = (event: ReactMouseEvent, item: DisplayItem) => {
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    openItem(item);
  };

  const handleItemMouseDown = (event: ReactMouseEvent) => {
    if (
      event.button === 0
      && event.target instanceof Element
      && !event.target.closest("[data-drive-action]")
    ) {
      event.preventDefault();
    }
  };

  const handleItemContextMenu = (event: ReactMouseEvent, item: DisplayItem) => {
    // Stop the right-click from bubbling to the container's blank-area
    // context menu so only the per-item menu opens.
    event.stopPropagation();
    if (selectedIds.has(item.id))
      return;
    onSelectionModeChange(true);
    onSelectedIdsChange(new Set([item.id]));
    setLastSelectedId(item.id);
  };

  const handleContextDelete = (item: DisplayItem) => {
    if (selectionMode && selectedIds.size > 1)
      onBatchDelete();
    else
      onDelete(item.id);
  };

  const isMultiSelectionActive = selectionMode && selectedIds.size > 1;

  const handleBatchDownload = () => {
    displayItems
      .filter(item => selectedIds.has(item.id) && !item.isFolder && item.fileId)
      .forEach(item => onDownload(item.fileId!, item.name));
  };

  const clearSelectionState = () => {
    if (!selectionMode && selectedIds.size === 0)
      return;
    onSelectedIdsChange(new Set());
    onSelectionModeChange(false);
    setLastSelectedId(null);
  };

  const clearSelection = () => {
    if (suppressNextBlankClickRef.current) {
      suppressNextBlankClickRef.current = false;
      return;
    }
    clearSelectionState();
  };

  const setItemRef = (id: string, node: HTMLDivElement | null) => {
    if (node)
      itemNodeMapRef.current.set(id, node);
    else
      itemNodeMapRef.current.delete(id);
  };

  const getPointerPointFromClient = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const container = containerRef.current;
    if (!container)
      return null;
    const rect = container.getBoundingClientRect();
    return {
      x: clientX - rect.left + container.scrollLeft,
      y: clientY - rect.top + container.scrollTop,
    };
  };

  const getPointerPoint = (event: ReactMouseEvent): { x: number; y: number } | null =>
    getPointerPointFromClient(event.clientX, event.clientY);

  const getSelectionBox = (state: DragSelectionState): SelectionBox => ({
    left: Math.min(state.originX, state.currentX),
    top: Math.min(state.originY, state.currentY),
    width: Math.abs(state.currentX - state.originX),
    height: Math.abs(state.currentY - state.originY),
  });

  const getItemBox = (node: HTMLDivElement): SelectionBox | null => {
    const container = containerRef.current;
    if (!container)
      return null;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      left: nodeRect.left - containerRect.left + container.scrollLeft,
      top: nodeRect.top - containerRect.top + container.scrollTop,
      width: nodeRect.width,
      height: nodeRect.height,
    };
  };

  const intersects = (a: SelectionBox, b: SelectionBox) =>
    a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;

  const updateSelectedIdsFromDrag = (state: DragSelectionState) => {
    const selectionBox = getSelectionBox(state);
    const nextSelectedIds = new Set(state.baseSelectedIds);
    for (const item of displayItems) {
      const node = itemNodeMapRef.current.get(item.id);
      const itemBox = node ? getItemBox(node) : null;
      if (itemBox && intersects(selectionBox, itemBox))
        nextSelectedIds.add(item.id);
    }
    onSelectedIdsChange(nextSelectedIds);
    onSelectionModeChange(nextSelectedIds.size > 0);
  };

  const shouldIgnoreDragStart = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest("[data-drive-item], [data-drive-action]"));

  const handleBlankMouseDownCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !shouldIgnoreDragStart(event.target)
    ) {
      suppressNextBlankClickRef.current = false;
      clearSelectionState();
    }
  };

  const updateDragSelection = (clientX: number, clientY: number) => {
    const currentDragSelection = dragSelectionRef.current;
    if (!currentDragSelection)
      return;
    const point = getPointerPointFromClient(clientX, clientY);
    if (!point)
      return;
    const hasDragged = currentDragSelection.hasDragged
      || Math.abs(point.x - currentDragSelection.originX) > 4
      || Math.abs(point.y - currentDragSelection.originY) > 4;
    const nextDragSelection = {
      ...currentDragSelection,
      currentX: point.x,
      currentY: point.y,
      hasDragged,
    };
    dragSelectionRef.current = nextDragSelection;
    setDragSelection(nextDragSelection);
    if (hasDragged)
      updateSelectedIdsFromDrag(nextDragSelection);
  };

  const removeDragListeners = () => {
    removeDragListenersRef.current?.();
    removeDragListenersRef.current = null;
  };

  const finishDragSelection = () => {
    const currentDragSelection = dragSelectionRef.current;
    if (!currentDragSelection)
      return;
    suppressNextBlankClickRef.current = currentDragSelection.hasDragged;
    dragSelectionRef.current = null;
    removeDragListeners();
    setDragSelection(null);
  };

  const startDragListeners = () => {
    removeDragListeners();
    const handleMouseMove = (event: MouseEvent) => updateDragSelection(event.clientX, event.clientY);
    const handleMouseUp = () => finishDragSelection();
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    removeDragListenersRef.current = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  };

  // Detach any window listeners if the list unmounts mid-drag.
  useEffect(() => () => removeDragListeners(), []);

  const handleSelectionMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || shouldIgnoreDragStart(event.target))
      return;
    const point = getPointerPoint(event);
    if (!point)
      return;
    event.preventDefault();
    const baseSelectedIds = event.metaKey || event.ctrlKey ? new Set(selectedIds) : new Set<string>();
    const nextDragSelection = {
      originX: point.x,
      originY: point.y,
      currentX: point.x,
      currentY: point.y,
      baseSelectedIds,
      hasDragged: false,
    };
    dragSelectionRef.current = nextDragSelection;
    setDragSelection(nextDragSelection);
    startDragListeners();
    if (!event.metaKey && !event.ctrlKey)
      clearSelectionState();
  };

  const itemMenu = (item: DisplayItem) => {
    const customActions = getCustomActions?.(item) ?? [];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <Button
              data-drive-action
              variant="ghost"
              size="icon-sm"
              aria-label={t("browser.action.more")}
              onClick={e => e.stopPropagation()}
            />
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isMultiSelectionActive
            ? (
                <>
                  {canDownload && (
                    <DropdownMenuItem onClick={handleBatchDownload}>
                      <Download className="mr-2 size-4" />
                      {t("browser.action.download")}
                    </DropdownMenuItem>
                  )}
                  {canRestore && onBatchRestore && (
                    <DropdownMenuItem onClick={onBatchRestore}>
                      <RotateCcw className="mr-2 size-4" />
                      {t("browser.action.restore")}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem variant="destructive" onClick={() => handleContextDelete(item)}>
                      <Trash2 className="mr-2 size-4" />
                      {t("browser.deleteSelected")}
                    </DropdownMenuItem>
                  )}
                </>
              )
            : (
                <>
                  {canDownload && !item.isFolder && item.fileId && (
                    <DropdownMenuItem onClick={() => onDownload(item.fileId!, item.name)}>
                      <Download className="mr-2 size-4" />
                      {t("browser.action.download")}
                    </DropdownMenuItem>
                  )}
                  {canShare && !item.isFolder && item.fileId && (
                    <DropdownMenuItem onClick={() => onShare(item.fileId!, item.name)}>
                      <Share2 className="mr-2 size-4" />
                      {t("browser.action.share")}
                    </DropdownMenuItem>
                  )}
                  {canRestore && onRestore && (
                    <DropdownMenuItem onClick={() => onRestore(item.id)}>
                      <RotateCcw className="mr-2 size-4" />
                      {t("browser.action.restore")}
                    </DropdownMenuItem>
                  )}
                  {canFavorite && !canRestore && (
                    <DropdownMenuItem onClick={() => onFavoriteChange(item, !item.isFavorite)}>
                      <Star className={cn("mr-2 size-4", item.isFavorite && "fill-current text-amber-500")} />
                      {t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
                    </DropdownMenuItem>
                  )}
                  {canRename && (
                    <DropdownMenuItem onClick={() => onRename(item)}>
                      <Pencil className="mr-2 size-4" />
                      {t("browser.action.rename")}
                    </DropdownMenuItem>
                  )}
                  {customActions.map(action => (
                    <DropdownMenuItem
                      key={action.key}
                      variant={action.variant ?? "default"}
                      onClick={() => action.onSelect(item)}
                    >
                      {action.icon}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                  {canDelete && (
                    <DropdownMenuItem variant="destructive" onClick={() => handleContextDelete(item)}>
                      <Trash2 className="mr-2 size-4" />
                      {t("browser.action.trash")}
                    </DropdownMenuItem>
                  )}
                </>
              )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const actionButtonClass = "size-7 rounded-full text-muted-foreground hover:text-foreground";

  const itemHoverToolbar = (item: DisplayItem) => {
    if (isMultiSelectionActive) {
      return (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 @max-[980px]:hidden">
          {canDownload && (
            <Button
              data-drive-action
              variant="ghost"
              size="icon"
              className={actionButtonClass}
              title={t("browser.action.download")}
              aria-label={t("browser.action.download")}
              onClick={(event) => {
                event.stopPropagation();
                handleBatchDownload();
              }}
            >
              <Download className="size-4" />
            </Button>
          )}
          {canRestore && onBatchRestore && (
            <Button
              data-drive-action
              variant="ghost"
              size="icon"
              className={actionButtonClass}
              title={t("browser.action.restore")}
              aria-label={t("browser.action.restore")}
              onClick={(event) => {
                event.stopPropagation();
                onBatchRestore();
              }}
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              data-drive-action
              variant="ghost"
              size="icon"
              className={cn(actionButtonClass, "text-destructive hover:text-destructive")}
              title={t("browser.deleteSelected")}
              aria-label={t("browser.deleteSelected")}
              onClick={(event) => {
                event.stopPropagation();
                onBatchDelete();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 @max-[980px]:hidden">
        {canShare && !item.isFolder && item.fileId && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            title={t("browser.action.share")}
            aria-label={t("browser.action.share")}
            onClick={(event) => {
              event.stopPropagation();
              onShare(item.fileId!, item.name);
            }}
          >
            <Share2 className="size-4" />
          </Button>
        )}
        {canDownload && !item.isFolder && item.fileId && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            title={t("browser.action.download")}
            aria-label={t("browser.action.download")}
            onClick={(event) => {
              event.stopPropagation();
              onDownload(item.fileId!, item.name);
            }}
          >
            <Download className="size-4" />
          </Button>
        )}
        {canRename && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            title={t("browser.action.rename")}
            aria-label={t("browser.action.rename")}
            onClick={(event) => {
              event.stopPropagation();
              onRename(item);
            }}
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {canFavorite && !canRestore && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={cn(actionButtonClass, item.isFavorite && "text-amber-500 hover:text-amber-600")}
            title={t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
            aria-label={t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
            onClick={(event) => {
              event.stopPropagation();
              onFavoriteChange(item, !item.isFavorite);
            }}
          >
            <Star className={cn("size-4", item.isFavorite && "fill-current")} />
          </Button>
        )}
      </div>
    );
  };

  const itemContextMenu = (item: DisplayItem) => {
    const customActions = getCustomActions?.(item) ?? [];
    return (
      <ContextMenuContent>
        {isMultiSelectionActive
          ? (
              <>
                {canDownload && (
                  <ContextMenuItem onClick={handleBatchDownload}>
                    <Download className="mr-2 size-4" />
                    {t("browser.action.download")}
                  </ContextMenuItem>
                )}
                {canRestore && onBatchRestore && (
                  <ContextMenuItem onClick={onBatchRestore}>
                    <RotateCcw className="mr-2 size-4" />
                    {t("browser.action.restore")}
                  </ContextMenuItem>
                )}
                {canDelete && (
                  <ContextMenuItem variant="destructive" onClick={() => handleContextDelete(item)}>
                    <Trash2 className="mr-2 size-4" />
                    {t("browser.deleteSelected")}
                  </ContextMenuItem>
                )}
              </>
            )
          : (
              <>
                {canDownload && !item.isFolder && item.fileId && (
                  <ContextMenuItem onClick={() => onDownload(item.fileId!, item.name)}>
                    <Download className="mr-2 size-4" />
                    {t("browser.action.download")}
                  </ContextMenuItem>
                )}
                {canShare && !item.isFolder && item.fileId && (
                  <ContextMenuItem onClick={() => onShare(item.fileId!, item.name)}>
                    <Share2 className="mr-2 size-4" />
                    {t("browser.action.share")}
                  </ContextMenuItem>
                )}
                {canRestore && onRestore && (
                  <ContextMenuItem onClick={() => onRestore(item.id)}>
                    <RotateCcw className="mr-2 size-4" />
                    {t("browser.action.restore")}
                  </ContextMenuItem>
                )}
                {canFavorite && !canRestore && (
                  <ContextMenuItem onClick={() => onFavoriteChange(item, !item.isFavorite)}>
                    <Star className={cn("mr-2 size-4", item.isFavorite && "fill-current text-amber-500")} />
                    {t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
                  </ContextMenuItem>
                )}
                {canRename && (
                  <ContextMenuItem onClick={() => onRename(item)}>
                    <Pencil className="mr-2 size-4" />
                    {t("browser.action.rename")}
                  </ContextMenuItem>
                )}
                {customActions.map(action => (
                  <ContextMenuItem
                    key={action.key}
                    variant={action.variant ?? "default"}
                    onClick={() => action.onSelect(item)}
                  >
                    {action.icon}
                    {action.label}
                  </ContextMenuItem>
                ))}
                {canDelete && (
                  <ContextMenuItem variant="destructive" onClick={() => handleContextDelete(item)}>
                    <Trash2 className="mr-2 size-4" />
                    {t("browser.action.trash")}
                  </ContextMenuItem>
                )}
              </>
            )}
      </ContextMenuContent>
    );
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="@container flex-1 overflow-auto" aria-busy={true}>
        {viewMode === "list"
          ? (
              <div className="w-full min-w-[560px] px-4 pt-1 pb-4">
                <div className={cn("grid items-center border-b px-4 py-2 text-sm leading-5 font-medium text-muted-foreground", LIST_COLUMNS_CLASS)}>
                  <div className="flex items-center gap-1.5">
                    {t("browser.column.name")}
                    <span className="flex size-5 items-center justify-center rounded-full bg-sky-200 text-sky-700 dark:bg-sky-900/70 dark:text-sky-300">
                      <ArrowUp className="size-3.5" />
                    </span>
                  </div>
                  <div className="@max-[760px]:hidden">{t("browser.column.owner")}</div>
                  <div>{t("browser.column.updated")}</div>
                  <div className="@max-[980px]:hidden">{t("browser.column.size")}</div>
                  <div className="sr-only @max-[980px]:hidden">{t("browser.column.actions")}</div>
                </div>
                {LIST_SKELETON_KEYS.map(key => (
                  <div key={key} className={cn("grid min-h-10 items-center border-b px-3 py-1", LIST_COLUMNS_CLASS)}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Skeleton className="size-4 shrink-0 rounded" />
                      <Skeleton className="h-4 w-56 max-w-full" />
                    </div>
                    <div className="flex min-w-0 items-center gap-2 @max-[760px]:hidden">
                      <Skeleton className="size-6 shrink-0 rounded-full" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-14 @max-[980px]:hidden" />
                    <Skeleton className="h-8 w-7 justify-self-end rounded-full" />
                  </div>
                ))}
              </div>
            )
          : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 px-4 pt-4 pb-6">
                {GRID_SKELETON_KEYS.map(key => (
                  <div key={key} className="rounded-2xl bg-muted/50 p-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="size-5 rounded" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                    <Skeleton className="mt-3 aspect-[4/3] w-full rounded-lg" />
                  </div>
                ))}
              </div>
            )}
      </div>
    );
  }

  // Empty state
  if (displayItems.length === 0) {
    return (
      <ContextMenu>
        <ContextMenuTrigger
          render={(
            <div className="flex-1 overflow-auto">
              <div className="flex h-full items-center justify-center">
                <div className="py-16 text-center">
                  <FolderOpen className="mx-auto mb-3 size-10 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">{t("browser.empty.folder")}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">{t("browser.empty.folderDesc")}</p>
                </div>
              </div>
            </div>
          )}
        />
        {blankContextMenu}
      </ContextMenu>
    );
  }

  const folderItems = displayItems.filter(item => item.isFolder);
  const fileItems = displayItems.filter(item => !item.isFolder);
  const dragSelectionBox = dragSelection?.hasDragged ? getSelectionBox(dragSelection) : null;

  const renderFolderGridItem = (item: DisplayItem) => (
    <ContextMenu key={item.id}>
      <ContextMenuTrigger
        render={(
          <div
            ref={node => setItemRef(item.id, node)}
            data-drive-item
            className={cn(
              "group relative flex h-16 cursor-pointer items-center gap-3 rounded-2xl bg-muted/50 px-4 transition-colors select-none hover:bg-muted",
              selectionMode && selectedIds.has(item.id) && "bg-sky-100/80 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-800",
            )}
            onMouseDown={handleItemMouseDown}
            onClick={event => handleItemClick(event, item)}
            onDoubleClick={event => handleItemDoubleClick(event, item)}
            onContextMenu={event => handleItemContextMenu(event, item)}
          />
        )}
      >
        <div className="absolute top-2 right-2">
          {itemMenu(item)}
        </div>
        {itemIcon(item, "size-6 shrink-0")}
        <span className="min-w-0 flex-1 truncate pr-8 text-sm font-medium select-none">{item.name}</span>
      </ContextMenuTrigger>
      {itemContextMenu(item)}
    </ContextMenu>
  );

  const renderFileGridItem = (item: DisplayItem) => (
    <ContextMenu key={item.id}>
      <ContextMenuTrigger
        render={(
          <div
            ref={node => setItemRef(item.id, node)}
            data-drive-item
            className={cn(
              "group relative cursor-pointer rounded-2xl bg-muted/50 p-3 transition-colors select-none hover:bg-muted",
              selectionMode && selectedIds.has(item.id) && "bg-sky-100/80 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-800",
            )}
            onMouseDown={handleItemMouseDown}
            onClick={event => handleItemClick(event, item)}
            onDoubleClick={event => handleItemDoubleClick(event, item)}
            onContextMenu={event => handleItemContextMenu(event, item)}
          />
        )}
      >
        <div className="absolute top-2 right-2">
          {itemMenu(item)}
        </div>
        <div className="flex h-9 items-center gap-2 pr-8">
          {itemIcon(item, "size-5 shrink-0")}
          <span className="min-w-0 flex-1 truncate text-sm font-medium select-none">{item.name}</span>
        </div>
        <div className="mt-3 aspect-[4/3] overflow-hidden rounded-lg bg-background">
          {thumbnailPreview(item)}
        </div>
        {item.size != null && <span className="sr-only">{formatSize(item.size)}</span>}
      </ContextMenuTrigger>
      {itemContextMenu(item)}
    </ContextMenu>
  );

  const renderGridSection = (title: string, items: DisplayItem[], kind: "folder" | "file") => {
    if (items.length === 0)
      return null;
    return (
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">{title}</h2>
        <div className={cn(
          "grid gap-4",
          kind === "folder"
            ? "grid-cols-[repeat(auto-fill,minmax(260px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(240px,1fr))]",
        )}
        >
          {items.map(kind === "folder" ? renderFolderGridItem : renderFileGridItem)}
        </div>
      </section>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={(
          <div
            ref={containerRef}
            className={cn("@container relative flex-1 overflow-auto", dragSelection && "select-none")}
            onClick={clearSelection}
            onMouseDownCapture={handleBlankMouseDownCapture}
            onMouseDown={handleSelectionMouseDown}
          />
        )}
      >
        {dragSelectionBox && (
          <div
            className="pointer-events-none absolute z-10 rounded border border-primary/60 bg-primary/10"
            style={{
              left: dragSelectionBox.left,
              top: dragSelectionBox.top,
              width: dragSelectionBox.width,
              height: dragSelectionBox.height,
            }}
          />
        )}
        {viewMode === "list"
          ? (
              <div className="w-full min-w-[560px] px-4 pt-1 pb-4">
                <div className={cn("grid items-center border-b px-4 py-2 text-sm leading-5 font-medium text-muted-foreground", LIST_COLUMNS_CLASS)}>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-left transition-colors hover:text-foreground"
                    onClick={() => onSortChange("name")}
                  >
                    {t("browser.column.name")}
                    {sortIcon("name")}
                  </button>
                  <div className="@max-[760px]:hidden">{t("browser.column.owner")}</div>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-left transition-colors hover:text-foreground"
                    onClick={() => onSortChange("modified")}
                  >
                    {t("browser.column.updated")}
                    {sortIcon("modified")}
                  </button>
                  <div className="@max-[980px]:hidden">{t("browser.column.size")}</div>
                  <div className="sr-only">{t("browser.column.actions")}</div>
                </div>
                {displayItems.map(item => (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger
                      render={(
                        <div
                          ref={node => setItemRef(item.id, node)}
                          data-drive-item
                          className={cn(
                            "group grid min-h-10 cursor-pointer items-center border-b px-3 py-1 transition-colors select-none hover:bg-accent/45",
                            LIST_COLUMNS_CLASS,
                            selectionMode && selectedIds.has(item.id) && "bg-sky-100/80 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-950/50",
                          )}
                          onMouseDown={handleItemMouseDown}
                          onClick={event => handleItemClick(event, item)}
                          onDoubleClick={event => handleItemDoubleClick(event, item)}
                          onContextMenu={event => handleItemContextMenu(event, item)}
                        />
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="shrink-0">
                          {itemIcon(item, "size-[18px]")}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium select-none">{item.name}</span>
                      </div>
                      <div className="flex min-w-0 items-center @max-[760px]:hidden">
                        <span className="truncate text-sm text-muted-foreground">{getOwnerLabel(item)}</span>
                      </div>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {formatDate(item.modified)}
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground @max-[980px]:hidden">
                        {item.isFolder ? "" : item.size ? formatSize(item.size) : ""}
                      </span>
                      <div className="flex items-center justify-end gap-1">
                        {itemHoverToolbar(item)}
                        {itemMenu(item)}
                      </div>
                    </ContextMenuTrigger>
                    {itemContextMenu(item)}
                  </ContextMenu>
                ))}
              </div>
            )
          : (
              <div className="space-y-6 px-4 pt-2 pb-6">
                {renderGridSection(t("browser.filter.folders"), folderItems, "folder")}
                {renderGridSection(t("browser.filter.files"), fileItems, "file")}
              </div>
            )}
      </ContextMenuTrigger>
      {blankContextMenu}
    </ContextMenu>
  );
}
