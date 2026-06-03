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
import { useNavigate } from "@tanstack/react-router";
import { FolderInput, History, Upload } from "lucide-react";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShare } from "@/shared/components/share";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";

import {
  downloadDriveEntry,
  isUniverSheetEntry,
  useCreateDriveFolder,
  useCreateSpreadsheet,
  useCreateTextFile,
  useDriveEntries,
  useDriveSearchEntries,
  useTrashDriveEntry,
  useUpdateDriveEntry,
} from "@/shared/lib/api/drive";
import { csvToUniverSnapshotJson, emptyUniverSnapshotJson } from "@/shared/lib/univer-snapshot";
import { cn } from "@/shared/lib/utils";
import { DriveFileListSurface } from "./-drive-file-list-surface";
import { useDriveUploader } from "./-drive-upload";
import { DriveVersionHistoryDialog } from "./-drive-version-history-dialog";
import {
  CreateFolderDialog,
  CreateSpreadsheetDialog,
  CreateTextFileDialog,
  MoveDialog,
  RenameDialog,
} from "./-entry-create-dialogs";
import { entryToDisplayItem } from "./-file-browser-types";
import { FilePreviewDialog } from "./-file-preview-dialog";

/**
 * Declarative feature toggles for the one global file browser. Every key is
 * optional and defaults to ENABLED — a surface opts OUT of what it doesn't
 * want (e.g. the project/ship tabs hide the breadcrumb and search box).
 * `manage`-gated affordances ALSO require `canManage`.
 */
export interface FileBrowserFeatures {
  /** Search box. */
  readonly search?: boolean;
  /** Title / root breadcrumb. */
  readonly breadcrumb?: boolean;
  /** Built-in preview dialog for normal (non-spreadsheet) files. */
  readonly preview?: boolean;
  /** Upload affordances. */
  readonly upload?: boolean;
  /** New folder / text / spreadsheet affordances. */
  readonly create?: boolean;
  /** Share action. */
  readonly share?: boolean;
  /** Version-history row action. */
  readonly versionHistory?: boolean;
  /** Rename / move / trash / favorite (also gated by `canManage`). */
  readonly manage?: boolean;
  /** Univer `.sheet` open routing to /drive/sheet/$entryId. */
  readonly spreadsheetRoute?: boolean;
}

export interface FileBrowserProps {
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
  /** Override the built-in share action (defaults to the app share dialog). */
  readonly onShareEntry?: (entry: DriveEntry) => void;
  /** Override the built-in preview (drive funnels every list through one chokepoint). */
  readonly onPreviewEntry?: (entry: DriveEntry, edit?: boolean) => void;
  /** When false, all mutating affordances are hidden or disabled (viewer role). */
  readonly canManage?: boolean;
  /** Label for the root breadcrumb (defaults to the generic "Root"). */
  readonly rootLabel?: string;
  /** Per-surface feature toggles; omitted keys default to enabled. */
  readonly features?: FileBrowserFeatures;
}

interface FolderCrumb {
  readonly id: string;
  readonly name: string;
}

type DialogState
  = | { readonly type: "folder" }
    | { readonly type: "text"; readonly markdown: boolean }
    | { readonly type: "spreadsheet" }
    | { readonly type: "rename"; readonly entry: DriveEntry }
    | { readonly type: "move"; readonly entry: DriveEntry }
    | { readonly type: "versions"; readonly entry: DriveEntry }
    | { readonly type: "trash"; readonly ids: readonly string[]; readonly name?: string | undefined }
    | null;

export function FileBrowser({
  ownerType,
  ownerId,
  onShareEntry,
  onPreviewEntry,
  canManage = true,
  rootLabel,
  features,
}: FileBrowserProps) {
  const { t } = useTranslation("drive");
  const navigate = useNavigate();
  const { openShare } = useShare();

  // Resolve feature toggles once; every key defaults to enabled.
  const f = {
    search: features?.search ?? true,
    breadcrumb: features?.breadcrumb ?? true,
    preview: features?.preview ?? true,
    upload: features?.upload ?? true,
    create: features?.create ?? true,
    share: features?.share ?? true,
    versionHistory: features?.versionHistory ?? true,
    manage: features?.manage ?? true,
    spreadsheetRoute: features?.spreadsheetRoute ?? true,
  };

  const [folderStack, setFolderStack] = useState<readonly FolderCrumb[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  // Internal preview state — used when the parent does not supply its own
  // `onPreviewEntry` (project/ship files tabs); drive overrides it.
  const [previewEntry, setPreviewEntry] = useState<DriveEntry | null>(null);
  const [previewEditing, setPreviewEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const owner = useMemo(() => ({ ownerType, ownerId }), [ownerType, ownerId]);
  const parentEntryId = folderStack.at(-1)?.id ?? null;

  const entriesQuery = useDriveEntries(parentEntryId, "normal", owner);
  const searchEntriesQuery = useDriveSearchEntries(searchQuery, owner);
  const useDriveSearch = searchQuery.trim().length > 0;
  const activeQuery = useDriveSearch ? searchEntriesQuery : entriesQuery;
  const entries = useMemo(() => activeQuery.data ?? [], [activeQuery.data]);

  const createFolder = useCreateDriveFolder();
  const createTextFile = useCreateTextFile();
  const createSpreadsheet = useCreateSpreadsheet();
  const enqueueUploads = useDriveUploader();
  const updateEntry = useUpdateDriveEntry();
  const trashEntry = useTrashDriveEntry();

  const error = activeQuery.error
    ?? createFolder.error
    ?? createTextFile.error
    ?? createSpreadsheet.error
    ?? updateEntry.error
    ?? trashEntry.error;

  // Created spreadsheets open straight in the dedicated editor route; the
  // open-routing chokepoint in `drive.lazy.tsx` handles existing entries.
  const openSheet = useCallback(
    (entry: DriveEntry) => void navigate({ to: "/drive/sheet/$entryId", params: { entryId: entry.id } }),
    [navigate],
  );

  // Default preview handler, mirroring `drive.lazy.tsx`'s openPreview: Univer
  // spreadsheets open the dedicated editor route; everything else opens the
  // in-app preview dialog rendered below.
  const internalOpenPreview = useCallback((entry: DriveEntry, edit = false) => {
    if (f.spreadsheetRoute && isUniverSheetEntry(entry)) {
      openSheet(entry);
      return;
    }
    setPreviewEntry(entry);
    setPreviewEditing(edit);
  }, [f.spreadsheetRoute, openSheet]);

  // Parent-supplied handler wins (drive routes everything through its own
  // chokepoint); otherwise the browser previews internally when preview is on.
  const handlePreview = onPreviewEntry ?? (f.preview ? internalOpenPreview : undefined);

  // Default share handler — open the app-wide share dialog. A parent override
  // wins; the toggle gates whether the action surfaces at all.
  const internalShare = useCallback(
    (entry: DriveEntry) => openShare({ resourceType: "drive_entry", resourceId: entry.id, name: entry.name }),
    [openShare],
  );
  const handleShare = onShareEntry ?? internalShare;

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

  // Read a picked CSV, convert it to a Univer snapshot, create the spreadsheet
  // entry, then open it in the editor. Parsing happens client-side (no Univer
  // import) so the heavy editor engine only loads on the editor route.
  const onCsvInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file)
      return;
    const baseName = file.name.replace(/\.csv$/i, "") || file.name;
    const text = await file.text();
    if (text.trim().length === 0) {
      toast.error(t("csv.empty"));
      return;
    }
    let content: string;
    try {
      content = csvToUniverSnapshotJson(text, baseName);
    }
    catch {
      toast.error(t("csv.importError"));
      return;
    }
    createSpreadsheet.mutate(
      { name: `${baseName}.sheet`, content, parentEntryId, ownerType, ownerId },
      { onSuccess: openSheet },
    );
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
    share: f.share,
    favorite: canManage && f.manage,
    rename: canManage && f.manage,
    delete: canManage && f.manage,
    batchDownload: true,
    batchDelete: canManage && f.manage,
    createFolder: canManage && f.create,
    upload: canManage && f.upload,
    createTextFile: canManage && f.create,
  };

  const toolbar: FolderToolbarConfig = {
    kind: "folder",
    ownerType: ownerType === "team_directory" ? "team" : ownerType,
    folderPath: [
      { id: null, name: rootLabel ?? t("browser.breadcrumbRoot") },
      ...folderStack.map(crumb => ({ id: crumb.id, name: crumb.name })),
    ],
    showCreateActions: canManage && f.create,
    // folderPath[0] is the synthetic root; index i>0 maps to folderStack[i-1].
    onNavigateToBreadcrumb: index =>
      setFolderStack(prev => (index <= 0 ? [] : prev.slice(0, index))),
  };

  // Stable primitives so the memoized action builder is not invalidated by the
  // freshly-spread `f` object each render.
  const canManageEntries = canManage && f.manage;
  const canViewVersions = canManage && f.versionHistory;

  const getCustomActions = useCallback((item: DisplayItem): FileListAction[] => {
    const entry = entryById.get(item.id);
    if (!entry)
      return [];
    const actions: FileListAction[] = [];
    if (canViewVersions && entry.file) {
      actions.push({
        key: "versions",
        label: t("browser.action.versions"),
        icon: <History className="mr-2 size-4" />,
        onSelect: () => setDialog({ type: "versions", entry }),
      });
    }
    if (canManageEntries) {
      actions.push({
        key: "move",
        label: t("browser.action.move"),
        icon: <FolderInput className="mr-2 size-4" />,
        onSelect: () => setDialog({ type: "move", entry }),
      });
    }
    return actions;
  }, [canManageEntries, canViewVersions, entryById, t]);

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
        (f.share ? handleShare : undefined)?.(entry);
    },
    onDelete: entryId => setDialog({ type: "trash", ids: [entryId], name: entryById.get(entryId)?.name }),
    onBatchDelete: (entryIds) => {
      const ids = [...entryIds];
      setDialog({ type: "trash", ids, name: ids.length === 1 ? entryById.get(ids[0]!)?.name : undefined });
    },
    onMoveEntries: (entryIds, targetParentEntryId) => {
      const nextParentEntryId = targetParentEntryId ?? parentEntryId;
      for (const id of entryIds) {
        const entry = entryById.get(id);
        if (!entry || entry.parentEntryId === nextParentEntryId)
          continue;
        updateEntry.mutate({ id, parentEntryId: nextParentEntryId });
      }
    },
    onPreview: (item) => {
      const entry = entryById.get(item.id);
      if (entry)
        handlePreview?.(entry);
    },
    onRename: (item) => {
      const entry = entryById.get(item.id);
      if (entry)
        setDialog({ type: "rename", entry });
    },
    onFavoriteChange: (item, favorite) => updateEntry.mutate({ id: item.id, favorite }),
    onCreateFolder: () => setDialog({ type: "folder" }),
    onUploadClick: () => fileInputRef.current?.click(),
    onUploadFolderClick: () => folderInputRef.current?.click(),
    onCreateTextFile: kind => setDialog({ type: "text", markdown: kind === "markdown" }),
    onCreateSpreadsheet: () => setDialog({ type: "spreadsheet" }),
    onImportCsv: () => csvInputRef.current?.click(),
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
      <input
        ref={(node) => {
          folderInputRef.current = node;
          node?.setAttribute("webkitdirectory", "");
          node?.setAttribute("directory", "");
        }}
        type="file"
        multiple
        className="hidden"
        onChange={onUploadInputChange}
      />
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={event => void onCsvInputChange(event)}
      />

      <DriveFileListSurface
        items={items}
        loading={activeQuery.isLoading}
        toolbar={toolbar}
        capabilities={capabilities}
        actions={actions}
        showTitle={f.breadcrumb}
        showSearch={f.search}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
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
              handlePreview?.(entry, true);
            },
          })}
      />
      <CreateSpreadsheetDialog
        open={dialog?.type === "spreadsheet"}
        onOpenChange={open => !open && closeDialog()}
        pending={createSpreadsheet.isPending}
        onCreate={({ name }) =>
          createSpreadsheet.mutate({ name, content: emptyUniverSnapshotJson(name), parentEntryId, ownerType, ownerId }, {
            onSuccess: (entry) => {
              closeDialog();
              openSheet(entry);
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
      <DriveVersionHistoryDialog
        open={dialog?.type === "versions"}
        onOpenChange={open => !open && closeDialog()}
        entry={dialog?.type === "versions" ? dialog.entry : null}
      />
      <ConfirmDeleteDialog
        open={dialog?.type === "trash"}
        onOpenChange={open => !open && closeDialog()}
        title={t("browser.dialog.trashTitle")}
        description={dialog?.type === "trash"
          ? dialog.ids.length === 1 && dialog.name
            ? t("browser.dialog.trashOne", { name: dialog.name })
            : t("browser.dialog.trashMany", { count: dialog.ids.length })
          : ""}
        confirmLabel={t("browser.action.trash")}
        pending={trashEntry.isPending}
        onConfirm={() => {
          if (dialog?.type !== "trash")
            return;
          for (const id of dialog.ids)
            trashEntry.mutate(id);
          closeDialog();
        }}
      />

      {/* Built-in preview — only when this browser owns preview (feature on)
          and the parent did not supply its own handler (drive renders its own
          dialog and passes onPreviewEntry). */}
      {f.preview && !onPreviewEntry && previewEntry && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          initialEditing={previewEditing}
          readOnly={!canManage}
          onOpenChange={open => !open && setPreviewEntry(null)}
        />
      )}
    </div>
  );
}
