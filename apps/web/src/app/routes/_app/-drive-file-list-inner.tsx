import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ItemActionsContext } from "./-drive-file-list-item-actions";
import type { DragSelectionState, FileListProps, SelectionBox } from "./-drive-file-list-types";
// Inner list / grid renderer for the drive file-list surface.
//
// Owns multi-select with rubber-band drag selection, per-row "more actions"
// dropdowns, item right-click context menus, and the blank-area create menu.
import type { DriveSortBy } from "./-file-browser-types";
import type { DisplayItem } from "@/shared/lib/file";
import {
  ArrowDown,
  ArrowUp,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
  FolderPlus,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { FILE_ICONS } from "@/shared/lib/file";
import { formatBytes, formatDate } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import {
  ItemContextMenu,
  ItemHoverToolbar,
  ItemMenu,
} from "./-drive-file-list-item-actions";
import {
  GRID_SKELETON_KEYS,
  LIST_COLUMNS_CLASS,
  LIST_SKELETON_KEYS,
} from "./-drive-file-list-types";

export function FileList({
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
  onMoveEntries,
  onPreview,
  onRename,
  onFavoriteChange,
  onCreateFolder,
  onUploadClick,
  onCreateTextFile,
  onCreateSpreadsheet,
  onImportCsv,
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
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [draggingEntryIds, setDraggingEntryIds] = useState<Set<string> | null>(null);

  const blankContextMenu = onCreateTextFile || onCreateFolder || onUploadClick || onCreateSpreadsheet || onImportCsv
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
          {onCreateSpreadsheet && (
            <ContextMenuItem onClick={onCreateSpreadsheet}>
              <FileSpreadsheet className="mr-2 size-4" />
              {t("browser.newSpreadsheet")}
            </ContextMenuItem>
          )}
          {onImportCsv && (
            <ContextMenuItem onClick={onImportCsv}>
              <FileUp className="mr-2 size-4" />
              {t("browser.importCsv")}
            </ContextMenuItem>
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
      {item.thumbnailUrl
        ? (
            <>
              {itemIcon(item, "size-14")}
              <img
                src={item.thumbnailUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            </>
          )
        : itemIcon(item, "size-14")}
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

  const getDragIds = (item: DisplayItem) =>
    selectionMode && selectedIds.has(item.id) ? new Set(selectedIds) : new Set([item.id]);

  const handleEntryDragStart = (event: ReactDragEvent<HTMLDivElement>, item: DisplayItem) => {
    if (!onMoveEntries)
      return;
    const ids = [...getDragIds(item)];
    setDraggingEntryIds(new Set(ids));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-drive-entry-ids", JSON.stringify(ids));
  };

  const readEntryDragIds = (event: ReactDragEvent) => {
    if (draggingEntryIds)
      return draggingEntryIds;
    const raw = event.dataTransfer.getData("application/x-drive-entry-ids");
    if (!raw)
      return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every(value => typeof value === "string")
        ? new Set<string>(parsed)
        : null;
    }
    catch {
      return null;
    }
  };

  const handleMoveDrop = (event: ReactDragEvent, parentEntryId: string | null) => {
    if (!onMoveEntries)
      return;
    const ids = readEntryDragIds(event);
    if (!ids || ids.size === 0)
      return;
    event.preventDefault();
    event.stopPropagation();
    setDragTargetId(null);
    setDraggingEntryIds(null);
    onMoveEntries(ids, parentEntryId);
  };

  const finishEntryDrag = () => {
    setDragTargetId(null);
    setDraggingEntryIds(null);
  };

  const handleFolderDragOver = (event: ReactDragEvent, item: DisplayItem) => {
    if (!onMoveEntries || !item.isFolder)
      return;
    const ids = readEntryDragIds(event);
    if (!ids || ids.has(item.id))
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragTargetId(item.id);
  };

  const handleRootDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!onMoveEntries || event.dataTransfer.types.includes("Files"))
      return;
    const ids = readEntryDragIds(event);
    if (!ids)
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetId("root");
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

  const itemActionsCtx: ItemActionsContext = {
    isMultiSelectionActive,
    canDelete,
    canDownload,
    canRename,
    canShare,
    canFavorite,
    canRestore,
    onDownload,
    onShare,
    onRestore,
    onBatchRestore,
    onBatchDownload: handleBatchDownload,
    onRename,
    onFavoriteChange,
    onContextDelete: handleContextDelete,
    onBatchDelete,
    getCustomActions,
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
            draggable={Boolean(onMoveEntries)}
            className={cn(
              "group relative flex h-16 cursor-pointer items-center gap-3 rounded-2xl bg-muted/50 px-4 transition-colors select-none hover:bg-muted",
              selectionMode && selectedIds.has(item.id) && "bg-sky-100/80 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-800",
              dragTargetId === item.id && "ring-2 ring-primary",
            )}
            onMouseDown={handleItemMouseDown}
            onClick={event => handleItemClick(event, item)}
            onDoubleClick={event => handleItemDoubleClick(event, item)}
            onContextMenu={event => handleItemContextMenu(event, item)}
            onDragStart={event => handleEntryDragStart(event, item)}
            onDragEnd={finishEntryDrag}
            onDragOver={event => handleFolderDragOver(event, item)}
            onDragLeave={() => setDragTargetId(current => (current === item.id ? null : current))}
            onDrop={event => handleMoveDrop(event, item.id)}
          />
        )}
      >
        <div className="absolute top-2 right-2">
          <ItemMenu item={item} ctx={itemActionsCtx} />
        </div>
        {itemIcon(item, "size-6 shrink-0")}
        <span className="min-w-0 flex-1 truncate pr-8 text-sm font-medium select-none">{item.name}</span>
      </ContextMenuTrigger>
      <ItemContextMenu item={item} ctx={itemActionsCtx} />
    </ContextMenu>
  );

  const renderFileGridItem = (item: DisplayItem) => (
    <ContextMenu key={item.id}>
      <ContextMenuTrigger
        render={(
          <div
            ref={node => setItemRef(item.id, node)}
            data-drive-item
            draggable={Boolean(onMoveEntries)}
            className={cn(
              "group relative cursor-pointer rounded-2xl bg-muted/50 p-3 transition-colors select-none hover:bg-muted",
              selectionMode && selectedIds.has(item.id) && "bg-sky-100/80 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-800",
            )}
            onMouseDown={handleItemMouseDown}
            onClick={event => handleItemClick(event, item)}
            onDoubleClick={event => handleItemDoubleClick(event, item)}
            onContextMenu={event => handleItemContextMenu(event, item)}
            onDragStart={event => handleEntryDragStart(event, item)}
            onDragEnd={finishEntryDrag}
          />
        )}
      >
        <div className="absolute top-2 right-2">
          <ItemMenu item={item} ctx={itemActionsCtx} />
        </div>
        <div className="flex h-9 items-center gap-2 pr-8">
          {itemIcon(item, "size-5 shrink-0")}
          <span className="min-w-0 flex-1 truncate text-sm font-medium select-none">{item.name}</span>
        </div>
        <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-lg bg-background">
          {thumbnailPreview(item)}
        </div>
        {item.size != null && <span className="sr-only">{formatBytes(item.size)}</span>}
      </ContextMenuTrigger>
      <ItemContextMenu item={item} ctx={itemActionsCtx} />
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
            onDragOver={handleRootDragOver}
            onDragLeave={() => setDragTargetId(current => (current === "root" ? null : current))}
            onDrop={event => handleMoveDrop(event, null)}
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
                  <Button
                    variant="ghost"
                    size="xs"
                    className="justify-start gap-1.5 text-left text-muted-foreground hover:text-foreground"
                    onClick={() => onSortChange("name")}
                  >
                    {t("browser.column.name")}
                    {sortIcon("name")}
                  </Button>
                  <div className="@max-[760px]:hidden">{t("browser.column.owner")}</div>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="justify-start gap-1.5 text-left text-muted-foreground hover:text-foreground"
                    onClick={() => onSortChange("modified")}
                  >
                    {t("browser.column.updated")}
                    {sortIcon("modified")}
                  </Button>
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
                          draggable={Boolean(onMoveEntries)}
                          className={cn(
                            "group grid min-h-10 cursor-pointer items-center border-b px-3 py-1 transition-colors select-none hover:bg-accent/45",
                            LIST_COLUMNS_CLASS,
                            selectionMode && selectedIds.has(item.id) && "bg-sky-100/80 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-950/50",
                            dragTargetId === item.id && "ring-2 ring-primary",
                          )}
                          onMouseDown={handleItemMouseDown}
                          onClick={event => handleItemClick(event, item)}
                          onDoubleClick={event => handleItemDoubleClick(event, item)}
                          onContextMenu={event => handleItemContextMenu(event, item)}
                          onDragStart={event => handleEntryDragStart(event, item)}
                          onDragEnd={finishEntryDrag}
                          onDragOver={event => handleFolderDragOver(event, item)}
                          onDragLeave={() => setDragTargetId(current => (current === item.id ? null : current))}
                          onDrop={event => item.isFolder && handleMoveDrop(event, item.id)}
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
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDate(item.modified)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground @max-[980px]:hidden">
                        {item.isFolder ? "" : item.size ? formatBytes(item.size) : ""}
                      </span>
                      <div className="flex items-center justify-end gap-1">
                        <ItemHoverToolbar item={item} ctx={itemActionsCtx} />
                        <ItemMenu item={item} ctx={itemActionsCtx} />
                      </div>
                    </ContextMenuTrigger>
                    <ItemContextMenu item={item} ctx={itemActionsCtx} />
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
