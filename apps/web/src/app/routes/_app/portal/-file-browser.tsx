import type { ChangeEvent, DragEvent } from "react";
import type { FolderCrumb } from "./-file-breadcrumbs";
import type { DriveTypeFilter } from "./-file-filter-bar";
import type { DriveEntry, DriveEntryStatus, DriveOwnerType } from "@/shared/lib/api/drive";
import { Upload } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner } from "@/shared/components/ui/error-banner";

import {
  downloadDriveEntry,
  useCreateDriveFolder,
  useCreateTextFile,
  useDeleteDriveEntryPermanently,
  useDriveEntries,
  useRestoreDriveEntry,
  useTrashDriveEntry,
  useUpdateDriveEntry,
  useUploadDriveFile,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";
import {
  CreateFolderDialog,
  CreateTextFileDialog,
  MoveDialog,
  RenameDialog,
} from "./-entry-create-dialogs";
import { FileBreadcrumbs } from "./-file-breadcrumbs";
import { FileFilterBar } from "./-file-filter-bar";
import { FileList } from "./-file-list";
import { FileToolbar } from "./-file-toolbar";
import { useDriveSelection } from "./-use-drive-selection";

export interface FileBrowserProps {
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
  readonly onShareEntry?: (entry: DriveEntry) => void;
  readonly onPreviewEntry?: (entry: DriveEntry) => void;
  /** When false, all mutating affordances are hidden or disabled (viewer role). */
  readonly canManage?: boolean;
}

type DialogState
  = | { readonly type: "folder" }
    | { readonly type: "text" }
    | { readonly type: "rename"; readonly entry: DriveEntry }
    | { readonly type: "move"; readonly entry: DriveEntry }
    | null;

export function FileBrowser({
  ownerType,
  ownerId,
  onShareEntry,
  onPreviewEntry,
  canManage = true,
}: FileBrowserProps) {
  const { t } = useTranslation("drive");

  const [status, setStatus] = useState<DriveEntryStatus>("normal");
  const [folderStack, setFolderStack] = useState<readonly FolderCrumb[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>("all");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selection = useDriveSelection();

  const owner = useMemo(() => ({ ownerType, ownerId }), [ownerType, ownerId]);
  const currentFolderId = folderStack.at(-1)?.id ?? null;
  // Trash is a flat list; folder scoping only applies to the normal view.
  const parentEntryId = status === "normal" ? currentFolderId : null;

  const entriesQuery = useDriveEntries(parentEntryId, status, owner);
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);

  const createFolder = useCreateDriveFolder();
  const createTextFile = useCreateTextFile();
  const uploadFile = useUploadDriveFile();
  const updateEntry = useUpdateDriveEntry();
  const trashEntry = useTrashDriveEntry();
  const restoreEntry = useRestoreDriveEntry();
  const permanentDelete = useDeleteDriveEntryPermanently();

  const busy = createFolder.isPending
    || createTextFile.isPending
    || uploadFile.isPending
    || updateEntry.isPending
    || trashEntry.isPending
    || restoreEntry.isPending
    || permanentDelete.isPending;

  const error = entriesQuery.error
    ?? createFolder.error
    ?? createTextFile.error
    ?? uploadFile.error
    ?? updateEntry.error
    ?? trashEntry.error
    ?? restoreEntry.error
    ?? permanentDelete.error;

  // Selection is scoped to one folder/status view; reset it on navigation.
  const clearSelection = selection.clear;
  useEffect(() => {
    clearSelection();
  }, [parentEntryId, status, clearSelection]);

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (typeFilter === "folders" && entry.type !== "folder")
        return false;
      if (typeFilter === "files" && entry.type !== "file")
        return false;
      if (query && !entry.name.toLowerCase().includes(query))
        return false;
      return true;
    });
  }, [entries, typeFilter, search]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const openFolder = useCallback((entry: DriveEntry) => {
    if (entry.type !== "folder" || status !== "normal")
      return;
    setFolderStack(prev => [...prev, { id: entry.id, name: entry.name }]);
  }, [status]);

  const navigate = useCallback((index: number) => {
    setFolderStack(prev => (index < 0 ? [] : prev.slice(0, index + 1)));
  }, []);

  const uploadFiles = useCallback((files: readonly File[]) => {
    for (const file of files)
      uploadFile.mutate({ file, parentEntryId, ownerType, ownerId });
  }, [uploadFile, parentEntryId, ownerType, ownerId]);

  const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    const list = files ? Array.from(files) : [];
    event.currentTarget.value = "";
    if (list.length > 0)
      uploadFiles(list);
  };

  const dropEnabled = canManage && status === "normal";

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dropEnabled || !event.dataTransfer.types.includes("Files"))
      return;
    event.preventDefault();
    setDragDepth(depth => depth + 1);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dropEnabled || !event.dataTransfer.types.includes("Files"))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dropEnabled)
      return;
    event.preventDefault();
    setDragDepth(depth => Math.max(0, depth - 1));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dropEnabled)
      return;
    event.preventDefault();
    setDragDepth(0);
    const list = Array.from(event.dataTransfer.files ?? []);
    if (list.length > 0)
      uploadFiles(list);
  };

  const handleBulkTrash = useCallback(() => {
    for (const id of selection.selected)
      trashEntry.mutate(id);
    selection.clear();
  }, [selection, trashEntry]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {status === "normal"
            ? (
                <FileBreadcrumbs
                  crumbs={folderStack}
                  rootLabel={t("browser.breadcrumbRoot")}
                  onNavigate={navigate}
                />
              )
            : <span className="text-sm font-medium text-muted-foreground">{t("browser.status.trash")}</span>}
          {status === "normal" && (
            <FileToolbar
              canManage={canManage}
              busy={busy}
              onUpload={() => fileInputRef.current?.click()}
              onNewFolder={() => setDialog({ type: "folder" })}
              onNewTextFile={() => setDialog({ type: "text" })}
            />
          )}
        </div>

        <FileFilterBar
          search={search}
          onSearchChange={setSearch}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          status={status}
          onStatusChange={setStatus}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onUploadInputChange}
      />

      <ErrorBanner message={error?.message} />

      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-auto rounded-lg",
          dragDepth > 0 && "outline-2 outline-offset-2 outline-primary",
        )}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragDepth > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-primary/5 text-sm font-medium text-primary">
            <Upload className="size-6" />
            {t("browser.dropHere")}
          </div>
        )}
        <FileList
          entries={visibleEntries}
          status={status}
          loading={entriesQuery.isLoading}
          canManage={canManage}
          busy={busy}
          selection={selection}
          onOpenFolder={openFolder}
          onRename={entry => setDialog({ type: "rename", entry })}
          onMove={entry => setDialog({ type: "move", entry })}
          onFavoriteToggle={entry => updateEntry.mutate({ id: entry.id, favorite: !entry.favorite })}
          onDownload={entry => void downloadDriveEntry(entry)}
          onShare={onShareEntry}
          onPreview={onPreviewEntry}
          onCopyLink={onShareEntry}
          onTrash={entry => trashEntry.mutate(entry.id)}
          onRestore={entry => restoreEntry.mutate(entry.id)}
          onPermanentDelete={entry => permanentDelete.mutate(entry.id)}
          onBulkTrash={handleBulkTrash}
        />
      </div>

      <CreateFolderDialog
        open={dialog?.type === "folder"}
        onOpenChange={open => !open && closeDialog()}
        pending={createFolder.isPending}
        onCreate={name => createFolder.mutate({ name, parentEntryId }, { onSuccess: closeDialog })}
      />
      <CreateTextFileDialog
        open={dialog?.type === "text"}
        onOpenChange={open => !open && closeDialog()}
        pending={createTextFile.isPending}
        onCreate={({ name, content }) =>
          createTextFile.mutate({ name, content, parentEntryId }, { onSuccess: closeDialog })}
      />
      <RenameDialog
        open={dialog?.type === "rename"}
        onOpenChange={open => !open && closeDialog()}
        entry={dialog?.type === "rename" ? dialog.entry : null}
        pending={updateEntry.isPending}
        onRename={(name) => {
          if (dialog?.type === "rename")
            updateEntry.mutate({ id: dialog.entry.id, name }, { onSuccess: closeDialog });
        }}
      />
      <MoveDialog
        open={dialog?.type === "move"}
        onOpenChange={open => !open && closeDialog()}
        entry={dialog?.type === "move" ? dialog.entry : null}
        owner={owner}
        pending={updateEntry.isPending}
        onMove={(targetParentId) => {
          if (dialog?.type === "move")
            updateEntry.mutate({ id: dialog.entry.id, parentEntryId: targetParentId }, { onSuccess: closeDialog });
        }}
      />
    </div>
  );
}
