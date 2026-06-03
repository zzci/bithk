import type {
  CollectionToolbarConfig,
  DriveFileListSurfaceProps,
} from "./-drive-file-list-types";
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
  DriveModifiedFilter,
  DriveOwnerFilter,
  DriveSortBy,
  DriveSourceFilter,
  DriveTypeFilter,
} from "./-file-browser-types";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { DriveFilterBar } from "./-drive-file-list-filter-bar";
import { FileList } from "./-drive-file-list-inner";
import { BatchControls, FileToolbar, ViewModeToggle } from "./-drive-file-list-toolbar";
import { DEFAULT_CAPABILITIES, getInitialViewMode } from "./-drive-file-list-types";

export type {
  CollectionToolbarConfig,
  DriveFileListCapabilities,
  DriveFileListSurfaceActions,
  DriveFileListSurfaceProps,
  FileListAction,
  FolderToolbarConfig,
  SurfaceExtraFilter,
  ToolbarConfig,
} from "./-drive-file-list-types";

export function DriveFileListSurface({
  items,
  loading,
  toolbar,
  capabilities,
  actions,
  initialViewMode = "list",
  viewModeStorageKey,
  banner,
  extraFilters,
  showTitle = true,
  showSearch = true,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
  i18nNs = "drive",
}: DriveFileListSurfaceProps) {
  const { t } = useTranslation(["drive", i18nNs]);
  const user = useAuthStore(s => s.user);
  const resolvedCapabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };

  const [viewMode, setViewMode] = useState<"grid" | "list">(() => getInitialViewMode(viewModeStorageKey, initialViewMode));
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<DriveSortBy>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<DriveOwnerFilter>("all");
  const [modifiedFilter, setModifiedFilter] = useState<DriveModifiedFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<DriveSourceFilter>("all");
  const searchQuery = showSearch ? (controlledSearchQuery ?? internalSearchQuery) : "";
  const setSearchQuery = onSearchQueryChange ?? setInternalSearchQuery;

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
      extraFilters={extraFilters}
    />
  );

  const renderCollectionToolbar = (config: CollectionToolbarConfig) => (
    <div className="flex shrink-0 flex-col bg-background">
      {(showTitle || showSearch || config.headerAction) && (
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 px-4">
          {showTitle
            ? (
                <div className="flex min-w-0 items-center gap-2 text-lg">
                  <span className="min-w-0 truncate font-medium text-foreground">{t(config.titleKey, { ns: i18nNs })}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={actions.onRefresh}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("browser.refresh")}
                  >
                    <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                  </Button>
                </div>
              )
            : <div />}

          <div className="flex shrink-0 items-center gap-2">
            {config.headerAction}
            {showSearch && (
              <div className="relative w-[360px] max-w-[42vw] shrink-0">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder={t("browser.searchPlaceholder")}
                  className="h-9 pl-9 text-sm"
                />
              </div>
            )}
          </div>
        </div>
      )}

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
          <p className="text-sm font-medium text-muted-foreground">{t(config.emptyTitleKey, { ns: i18nNs })}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t(config.emptyDescKey, { ns: i18nNs })}</p>
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
              showTitle={showTitle}
              showSearch={showSearch}
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
              onUploadFolderClick={actions.onUploadFolderClick}
              onCreateTextFile={resolvedCapabilities.createTextFile ? actions.onCreateTextFile : undefined}
              onCreateSpreadsheet={resolvedCapabilities.createTextFile ? actions.onCreateSpreadsheet : undefined}
              onImportCsv={resolvedCapabilities.createTextFile ? actions.onImportCsv : undefined}
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
                onMoveEntries={actions.onMoveEntries}
                onRestore={actions.onRestore}
                onBatchRestore={handleBatchRestore}
                onPreview={actions.onPreview}
                onRename={actions.onRename}
                onFavoriteChange={actions.onFavoriteChange}
                onCreateFolder={resolvedCapabilities.createFolder ? actions.onCreateFolder : undefined}
                onUploadClick={resolvedCapabilities.upload ? actions.onUploadClick : undefined}
                onCreateTextFile={resolvedCapabilities.createTextFile ? actions.onCreateTextFile : undefined}
                onCreateSpreadsheet={resolvedCapabilities.createTextFile ? actions.onCreateSpreadsheet : undefined}
                onImportCsv={resolvedCapabilities.createTextFile ? actions.onImportCsv : undefined}
                getCustomActions={actions.getCustomActions}
              />
            )}
      </div>
    </div>
  );
}
