// Shared toolbar controls and the folder toolbar for the drive file-list surface.
import type { DriveFileListCapabilities, FileToolbarProps } from "./file-list-types";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderInput,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

// ── Shared toolbar controls ──

export function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  readonly viewMode: "grid" | "list";
  readonly onViewModeChange: (mode: "grid" | "list") => void;
}) {
  const { t } = useTranslation("drive");
  return (
    <div className="mr-1 flex h-8 items-center gap-1 rounded-md border bg-background px-0.5">
      <Button
        variant="ghost"
        size="icon"
        className={cn("size-7", viewMode === "grid" && "bg-accent")}
        onClick={() => onViewModeChange("grid")}
        aria-label={t("browser.viewGrid")}
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("size-7", viewMode === "list" && "bg-accent")}
        onClick={() => onViewModeChange("list")}
        aria-label={t("browser.viewList")}
      >
        <List className="size-4" />
      </Button>
    </div>
  );
}

export function BatchControls({
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
        <Button variant="ghost" size="icon" onClick={onBatchDownload} aria-label={t("browser.action.download")}>
          <Download className="size-4" />
        </Button>
      )}
      {capabilities.batchRestore && hasRestore && (
        <Button variant="ghost" size="icon" onClick={onBatchRestore} aria-label={t("browser.action.restore")}>
          <RotateCcw className="size-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" onClick={onCancel} aria-label={t("common.cancel")}>
        <X className="size-4" />
      </Button>
      {capabilities.batchDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
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

export function FileToolbar({
  variant = "full",
  ownerType,
  folderPath,
  loading,
  viewMode,
  selectionMode,
  selectedCount,
  showTitle,
  showSearch,
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
  onUploadFolderClick,
  onCreateTextFile,
  onCreateSpreadsheet,
  onImportCsv,
  onImportFromDrive,
  extraActions,
}: FileToolbarProps) {
  const { t } = useTranslation("drive");
  const hasSelection = selectionMode && selectedCount > 0;

  return (
    <div className="flex shrink-0 flex-col bg-background">
      {(showTitle || showSearch) && (
        <div className="flex h-14 flex-wrap items-center justify-between gap-4 px-4">
          {showTitle
            ? (
                <div className="flex min-w-0 items-center gap-2 text-lg">
                  <nav aria-label={t("browser.breadcrumbLabel")}>
                    <ol className="flex min-w-0 items-center gap-2">
                      {folderPath.map((crumb, i) => (
                        <li key={crumb.id ?? "root"} className="flex min-w-0 items-center gap-2">
                          {i > 0 && <span aria-hidden="true" className="text-muted-foreground/60">/</span>}
                          {i === folderPath.length - 1
                            ? (
                                <span
                                  aria-current="page"
                                  className="min-w-0 truncate text-lg font-medium text-foreground"
                                >
                                  {crumb.name}
                                </span>
                              )
                            : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => onNavigateToBreadcrumb(i)}
                                  className={cn(
                                    "h-auto min-w-0 truncate px-0 text-lg font-normal transition-colors hover:bg-transparent",
                                    "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  {crumb.name}
                                </Button>
                              )}
                        </li>
                      ))}
                    </ol>
                  </nav>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onRefresh}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("browser.refresh")}
                  >
                    <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                  </Button>
                </div>
              )
            : <div />}

          {showSearch && (
            <div className="relative w-[min(360px,calc(100vw-140px))] shrink-0">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => onSearchQueryChange(e.target.value)}
                placeholder={t("browser.searchPlaceholder")}
                className="h-9 pl-9 text-sm"
              />
            </div>
          )}
        </div>
      )}

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
                    {extraActions}
                    {variant === "full" && (
                      <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
                    )}
                    {showCreateActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={(
                            <Button variant="default" aria-label={t("browser.createButton")} />
                          )}
                        >
                          <Plus className="mr-1 size-4" />
                          {t("browser.createButton")}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          {onCreateFolder && (
                            <DropdownMenuItem onClick={onCreateFolder}>
                              <FolderPlus className="mr-2 size-4" />
                              {t("browser.newFolder")}
                            </DropdownMenuItem>
                          )}
                          {onCreateTextFile && (
                            <>
                              <DropdownMenuItem onClick={() => onCreateTextFile("text")}>
                                <FileText className="mr-2 size-4" />
                                {t("browser.newTextFile")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onCreateTextFile("markdown")}>
                                <FileText className="mr-2 size-4" />
                                {t("browser.newMarkdownFile")}
                              </DropdownMenuItem>
                            </>
                          )}
                          {onCreateSpreadsheet && (
                            <DropdownMenuItem onClick={onCreateSpreadsheet}>
                              <FileSpreadsheet className="mr-2 size-4" />
                              {t("browser.newSpreadsheet")}
                            </DropdownMenuItem>
                          )}
                          {onUploadClick && (
                            <DropdownMenuItem onClick={onUploadClick}>
                              <Upload className="mr-2 size-4" />
                              {t("browser.upload")}
                            </DropdownMenuItem>
                          )}
                          {onUploadFolderClick && (
                            <DropdownMenuItem onClick={onUploadFolderClick}>
                              <FolderUp className="mr-2 size-4" />
                              {t("browser.uploadFolder")}
                            </DropdownMenuItem>
                          )}
                          {onImportCsv && (
                            <DropdownMenuItem onClick={onImportCsv}>
                              <FileUp className="mr-2 size-4" />
                              {t("browser.importCsv")}
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
