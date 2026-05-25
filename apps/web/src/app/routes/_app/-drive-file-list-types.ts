import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
// Shared types, constants, and helpers for the drive file-list surface.
//
// These are extracted from `-drive-file-list-surface.tsx` so the surface,
// toolbar, filter bar, and inner list/grid modules can share the same
// contracts without circular imports.
import type {
  DisplayItem,
  DriveModifiedFilter,
  DriveOwnerFilter,
  DriveSortBy,
  DriveSourceFilter,
  DriveTypeFilter,
} from "./-file-browser-types";

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
  readonly onShare: (entryId: string, name: string) => void;
  readonly onDelete: (entryId: string) => void;
  readonly onBatchDelete: (entryIds: Set<string>) => void;
  readonly onMoveEntries?: (entryIds: Set<string>, parentEntryId: string | null) => void;
  readonly onRestore?: (entryId: string) => void;
  readonly onBatchRestore?: (entryIds: Set<string>) => void;
  readonly onPreview: (item: DisplayItem) => void;
  readonly onRename: (item: DisplayItem) => void;
  readonly onFavoriteChange: (item: DisplayItem, favorite: boolean) => void;
  readonly onCreateFolder?: () => void;
  readonly onUploadClick?: () => void;
  readonly onUploadFolderClick?: () => void;
  readonly onCreateTextFile?: (kind: "markdown" | "text") => void;
  readonly getCustomActions?: (item: DisplayItem) => FileListAction[];
}

/**
 * A caller-owned extra filter dropdown, rendered after the built-in filters.
 * The caller filters its own data; the surface only renders the control.
 * Use `"all"` as the not-filtering value so the active-state highlight works.
 */
export interface SurfaceExtraFilter {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
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
  readonly extraFilters?: readonly SurfaceExtraFilter[] | undefined;
  readonly showTitle?: boolean | undefined;
  readonly showSearch?: boolean | undefined;
  readonly searchQuery?: string | undefined;
  readonly onSearchQueryChange?: ((query: string) => void) | undefined;
  readonly searchScope?: "current" | "drive" | undefined;
  readonly onSearchScopeChange?: ((scope: "current" | "drive") => void) | undefined;
  /**
   * Namespace for the collection toolbar's `titleKey` / `emptyTitleKey` /
   * `emptyDescKey` only. Defaults to `"drive"`; the share lists pass
   * `"share"` so their copy lives in the unified share namespace. All other
   * surface labels (filters, columns, actions) always use `"drive"`.
   */
  readonly i18nNs?: string;
}

export const DEFAULT_CAPABILITIES: Required<DriveFileListCapabilities> = {
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

export function getInitialViewMode(storageKey: string | undefined, fallback: "grid" | "list"): "grid" | "list" {
  if (!storageKey || typeof window === "undefined")
    return fallback;
  const stored = window.localStorage.getItem(storageKey);
  return stored === "grid" || stored === "list" ? stored : fallback;
}

// ── Filter bar ──

export interface DriveFilterBarProps {
  readonly typeFilter: DriveTypeFilter;
  readonly ownerFilter: DriveOwnerFilter;
  readonly modifiedFilter: DriveModifiedFilter;
  readonly sourceFilter: DriveSourceFilter;
  readonly onTypeFilterChange: (value: DriveTypeFilter) => void;
  readonly onOwnerFilterChange: (value: DriveOwnerFilter) => void;
  readonly onModifiedFilterChange: (value: DriveModifiedFilter) => void;
  readonly onSourceFilterChange: (value: DriveSourceFilter) => void;
  readonly extraFilters?: readonly SurfaceExtraFilter[] | undefined;
}

// ── Folder toolbar ──

export interface FileToolbarProps {
  readonly variant?: "full" | "compact" | undefined;
  readonly ownerType: "user" | "team" | "project";
  readonly folderPath: readonly { readonly id: string | null; readonly name: string }[];
  readonly loading: boolean;
  readonly viewMode: "grid" | "list";
  readonly selectionMode: boolean;
  readonly selectedCount: number;
  readonly showTitle: boolean;
  readonly showSearch: boolean;
  readonly searchQuery: string;
  readonly searchScope?: "current" | "drive" | undefined;
  readonly filterBar: ReactNode;
  readonly capabilities: Required<DriveFileListCapabilities>;
  readonly hasRestore: boolean;
  readonly onNavigateToBreadcrumb: (index: number) => void;
  readonly onRefresh: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSearchScopeChange?: ((scope: "current" | "drive") => void) | undefined;
  readonly onViewModeChange: (mode: "grid" | "list") => void;
  readonly onCancelSelection: () => void;
  readonly onBatchDownload: () => void;
  readonly onBatchRestore: () => void;
  readonly onBatchDelete: () => void;
  readonly onMoveEntries?: ((entryIds: Set<string>, parentEntryId: string | null) => void) | undefined;
  readonly showCreateActions?: boolean | undefined;
  readonly onCreateFolder?: (() => void) | undefined;
  readonly onUploadClick?: (() => void) | undefined;
  readonly onUploadFolderClick?: (() => void) | undefined;
  readonly onImportFromDrive?: (() => void) | undefined;
}

// ── Inner list / grid ──

export const LIST_SKELETON_KEYS = Array.from({ length: 8 }, (_, index) => `list-skeleton-${index}`);
export const GRID_SKELETON_KEYS = Array.from({ length: 12 }, (_, index) => `grid-skeleton-${index}`);

export interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DragSelectionState {
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  baseSelectedIds: Set<string>;
  hasDragged: boolean;
}

export interface FileListProps {
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
  readonly onShare: (entryId: string, name: string) => void;
  readonly onDelete: (entryId: string) => void;
  readonly onRestore?: ((entryId: string) => void) | undefined;
  readonly onBatchRestore?: (() => void) | undefined;
  readonly onBatchDelete: () => void;
  readonly onMoveEntries?: ((entryIds: Set<string>, parentEntryId: string | null) => void) | undefined;
  readonly onPreview: (item: DisplayItem) => void;
  readonly onRename: (item: DisplayItem) => void;
  readonly onFavoriteChange: (item: DisplayItem, favorite: boolean) => void;
  readonly onCreateFolder?: (() => void) | undefined;
  readonly onUploadClick?: (() => void) | undefined;
  readonly onCreateTextFile?: ((kind: "markdown" | "text") => void) | undefined;
  readonly getCustomActions?: ((item: DisplayItem) => FileListAction[]) | undefined;
}

export const LIST_COLUMNS_CLASS = "grid-cols-[minmax(280px,1.6fr)_minmax(160px,0.7fr)_minmax(160px,0.75fr)_88px_160px] @max-[980px]:grid-cols-[minmax(260px,1.45fr)_minmax(150px,0.7fr)_minmax(136px,0.55fr)_40px] @max-[760px]:grid-cols-[minmax(280px,1fr)_112px_40px]";
