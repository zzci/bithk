// Folder-mode wrapper over the shared DriveFileListSurface.
//
// This component owns folder navigation state and the create/rename/move
// dialogs, fetches the current folder's entries from the API, bridges them to
// the surface's `DisplayItem[]`, and wires every mutating affordance through
// the surface `actions` bag. The list rendering, search, filters, sorting,
// selection, and context menus all live in the surface.

import type { ChangeEvent, DragEvent } from "react";
import type {
  DriveFileListCapabilities,
  DriveFileListSurfaceActions,
  FileListAction,
  FolderToolbarConfig,
} from "./-drive-file-list-surface";
import type { DisplayItem } from "./-file-browser-types";
import type { DriveEntry, DriveOwnerType } from "@/shared/lib/api/drive";
import { FolderInput, Upload } from "lucide-react";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner } from "@/shared/components/ui/error-banner";

import {
  downloadDriveEntry,
  useCreateDriveFolder,
  useCreateTextFile,
  useDriveEntries,
  useTrashDriveEntry,
  useUpdateDriveEntry,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";
import { DriveFileListSurface } from "./-drive-file-list-surface";
import { useDriveUploader } from "./-drive-upload";
import {
  CreateFolderDialog,
  CreateTextFileDialog,
  MoveDialog,
  RenameDialog,
} from "./-entry-create-dialogs";
import { entryToDisplayItem } from "./-file-browser-types";

export interface FileBrowserProps {
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
  readonly onShareEntry?: (entry: DriveEntry) => void;
  readonly onPreviewEntry?: (entry: DriveEntry, edit?: boolean) => void;
  /** When false, all mutating affordances are hidden or disabled (viewer role). */
  readonly canManage?: boolean;
  /** Label for the root breadcrumb (defaults to the generic "Root"). */
  readonly rootLabel?: string;
}

interface FolderCrumb {
  readonly id: string;
  readonly name: string;
}

type DialogState
  = | { readonly type: "folder" }
    | { readonly type: "text"; readonly markdown: boolean }
    | { readonly type: "rename"; readonly entry: DriveEntry }
    | { readonly type: "move"; readonly entry: DriveEntry }
    | null;

export function FileBrowser({
  ownerType,
  ownerId,
  onShareEntry,
  onPreviewEntry,
  canManage = true,
  rootLabel,
}: FileBrowserProps) {
  const { t } = useTranslation("drive");

  const [folderStack, setFolderStack] = useState<readonly FolderCrumb[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const owner = useMemo(() => ({ ownerType, ownerId }), [ownerType, ownerId]);
  const parentEntryId = folderStack.at(-1)?.id ?? null;

  const entriesQuery = useDriveEntries(parentEntryId, "normal", owner);
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);

  const createFolder = useCreateDriveFolder();
  const createTextFile = useCreateTextFile();
  const enqueueUploads = useDriveUploader();
  const updateEntry = useUpdateDriveEntry();
  const trashEntry = useTrashDriveEntry();

  const error = entriesQuery.error
    ?? createFolder.error
    ?? createTextFile.error
    ?? updateEntry.error
    ?? trashEntry.error;

  // Look up the source entry behind a surface item: the surface passes back an
  // entry id (preview/rename/favorite) or a file id (download/share) only.
  const entryById = useMemo(
    () => new Map(entries.map(entry => [entry.id, entry])),
    [entries],
  );
  const entryByFileId = useMemo(
    () => new Map(entries.filter(entry => entry.file).map(entry => [entry.file!.fileId, entry])),
    [entries],
  );

  const items = useMemo<readonly DisplayItem[]>(
    () => entries.map(entryToDisplayItem),
    [entries],
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  const uploadFiles = useCallback((files: readonly File[]) => {
    enqueueUploads(files, { ownerType, ownerId, parentEntryId });
  }, [enqueueUploads, parentEntryId, ownerType, ownerId]);

  const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    const list = files ? Array.from(files) : [];
    event.currentTarget.value = "";
    if (list.length > 0)
      uploadFiles(list);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!canManage || !event.dataTransfer.types.includes("Files"))
      return;
    event.preventDefault();
    setDragDepth(depth => depth + 1);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canManage || !event.dataTransfer.types.includes("Files"))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!canManage)
      return;
    event.preventDefault();
    setDragDepth(depth => Math.max(0, depth - 1));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!canManage)
      return;
    event.preventDefault();
    setDragDepth(0);
    const list = Array.from(event.dataTransfer.files ?? []);
    if (list.length > 0)
      uploadFiles(list);
  };

  const capabilities: DriveFileListCapabilities = {
    navigateFolders: true,
    download: true,
    share: Boolean(onShareEntry),
    favorite: canManage,
    rename: canManage,
    delete: canManage,
    batchDownload: true,
    batchDelete: canManage,
    createFolder: canManage,
    upload: canManage,
    createTextFile: canManage,
  };

  const toolbar: FolderToolbarConfig = {
    kind: "folder",
    ownerType: ownerType === "team_directory" ? "team" : "user",
    folderPath: [
      { id: null, name: rootLabel ?? t("browser.breadcrumbRoot") },
      ...folderStack.map(crumb => ({ id: crumb.id, name: crumb.name })),
    ],
    showCreateActions: canManage,
    // folderPath[0] is the synthetic root; index i>0 maps to folderStack[i-1].
    onNavigateToBreadcrumb: index =>
      setFolderStack(prev => (index <= 0 ? [] : prev.slice(0, index))),
  };

  const getCustomActions = useCallback((item: DisplayItem): FileListAction[] => {
    if (!canManage)
      return [];
    const entry = entryById.get(item.id);
    if (!entry)
      return [];
    return [{
      key: "move",
      label: t("browser.action.move"),
      icon: <FolderInput className="mr-2 size-4" />,
      onSelect: () => setDialog({ type: "move", entry }),
    }];
  }, [canManage, entryById, t]);

  const actions: DriveFileListSurfaceActions = {
    onRefresh: () => void entriesQuery.refetch(),
    onNavigateToFolder: (entryId, folderName) =>
      setFolderStack(prev => [...prev, { id: entryId, name: folderName }]),
    onDownload: (fileId) => {
      const entry = entryByFileId.get(fileId);
      if (entry)
        void downloadDriveEntry(entry);
    },
    onShare: (entryId) => {
      const entry = entryById.get(entryId);
      if (entry)
        onShareEntry?.(entry);
    },
    onDelete: entryId => trashEntry.mutate(entryId),
    onBatchDelete: (entryIds) => {
      for (const id of entryIds)
        trashEntry.mutate(id);
    },
    onPreview: (item) => {
      const entry = entryById.get(item.id);
      if (entry)
        onPreviewEntry?.(entry);
    },
    onRename: (item) => {
      const entry = entryById.get(item.id);
      if (entry)
        setDialog({ type: "rename", entry });
    },
    onFavoriteChange: (item, favorite) => updateEntry.mutate({ id: item.id, favorite }),
    onCreateFolder: () => setDialog({ type: "folder" }),
    onUploadClick: () => fileInputRef.current?.click(),
    onCreateTextFile: kind => setDialog({ type: "text", markdown: kind === "markdown" }),
    getCustomActions,
  };

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col rounded-lg",
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

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onUploadInputChange}
      />

      <DriveFileListSurface
        items={items}
        loading={entriesQuery.isLoading}
        toolbar={toolbar}
        capabilities={capabilities}
        actions={actions}
        banner={error ? <ErrorBanner message={error.message} className="mx-4 mb-2" /> : undefined}
      />

      <CreateFolderDialog
        open={dialog?.type === "folder"}
        onOpenChange={open => !open && closeDialog()}
        pending={createFolder.isPending}
        onCreate={name => createFolder.mutate({ name, parentEntryId, ownerType, ownerId }, { onSuccess: closeDialog })}
      />
      <CreateTextFileDialog
        open={dialog?.type === "text"}
        markdown={dialog?.type === "text" ? dialog.markdown : false}
        onOpenChange={open => !open && closeDialog()}
        pending={createTextFile.isPending}
        onCreate={({ name }) =>
          createTextFile.mutate({ name, content: "", parentEntryId, ownerType, ownerId }, {
            onSuccess: (entry) => {
              closeDialog();
              onPreviewEntry?.(entry, true);
            },
          })}
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
