// Collection views (recent / favorites / trash) for the drive page. Each view
// renders through the shared `DriveFileListSurface` in collection mode: it
// fetches its `DriveEntry[]` from the API layer, bridges them to `DisplayItem`s
// with `entryToDisplayItem`, and routes every mutating affordance through the
// surface `actions` bag (plus `getCustomActions` for the trash-only permanent
// delete). The folder-navigation browser lives in -file-browser.tsx.

import type { UseQueryResult } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import type {
  CollectionToolbarConfig,
  DriveFileListCapabilities,
  DriveFileListSurfaceActions,
  FileListAction,
  FolderToolbarConfig,
  ToolbarConfig,
} from "./-drive-file-list-surface";
import type { DriveEntry } from "@/shared/lib/api/drive";
import { Clock, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  downloadDriveEntry,
  useDeleteDriveEntryPermanently,
  useDriveEntries,
  useFavoriteEntries,
  useRecentEntries,
  useRestoreDriveEntry,
  useUpdateDriveEntry,
} from "@/shared/lib/api/drive";
import { DriveFileListSurface } from "./-drive-file-list-surface";
import { RenameDialog } from "./-entry-create-dialogs";
import { entryToDisplayItem } from "./-file-browser-types";
import { ShareDialog } from "./-share-dialog";

export type DriveListSource = "recent" | "favorites" | "trash";

interface ListProps {
  readonly source: DriveListSource;
  readonly userId: string;
  readonly onPreviewEntry?: ((entry: DriveEntry) => void) | undefined;
}

// One fetch wrapper per source so only the active view's query runs; React
// forbids calling the other query hooks conditionally from a single component.
export function DriveEntryListView({ source, userId, onPreviewEntry }: ListProps) {
  if (source === "recent")
    return <RecentCollection userId={userId} onPreviewEntry={onPreviewEntry} />;
  if (source === "favorites")
    return <FavoritesCollection userId={userId} onPreviewEntry={onPreviewEntry} />;
  return <TrashCollection userId={userId} onPreviewEntry={onPreviewEntry} />;
}

type CollectionWrapperProps = Pick<ListProps, "userId" | "onPreviewEntry">;

function RecentCollection({ userId, onPreviewEntry }: CollectionWrapperProps) {
  return <Collection mode="recent" userId={userId} query={useRecentEntries()} onPreviewEntry={onPreviewEntry} />;
}

function FavoritesCollection({ userId, onPreviewEntry }: CollectionWrapperProps) {
  return <Collection mode="favorites" userId={userId} query={useFavoriteEntries()} onPreviewEntry={onPreviewEntry} />;
}

function TrashCollection({ userId, onPreviewEntry }: CollectionWrapperProps) {
  const query = useDriveEntries(null, "trash", { ownerType: "user", ownerId: userId });
  return <Collection mode="trash" userId={userId} query={query} onPreviewEntry={onPreviewEntry} />;
}

const COLLECTION_TOOLBAR: Record<DriveListSource, {
  readonly titleKey: string;
  readonly emptyIcon: LucideIcon;
  readonly emptyTitleKey: string;
  readonly emptyDescKey: string;
}> = {
  recent: {
    titleKey: "sidebar.recent",
    emptyIcon: Clock,
    emptyTitleKey: "sidebar.empty.recent",
    emptyDescKey: "browser.empty.recentDesc",
  },
  favorites: {
    titleKey: "sidebar.favorites",
    emptyIcon: Star,
    emptyTitleKey: "sidebar.empty.favorites",
    emptyDescKey: "browser.empty.favoritesDesc",
  },
  trash: {
    titleKey: "sidebar.trash",
    emptyIcon: Trash2,
    emptyTitleKey: "sidebar.empty.trash",
    emptyDescKey: "browser.empty.trashDesc",
  },
};

// Recent/favorites are read-mostly collections (download/share/favorite/rename,
// no folder navigation); trash swaps sharing/favoriting for restore + permanent
// delete. Capabilities the surface defaults to `true` are pinned off here so a
// future surface default change cannot silently re-enable them for collections.
const COLLECTION_CAPABILITIES: Record<DriveListSource, DriveFileListCapabilities> = {
  recent: {
    download: true,
    share: true,
    favorite: true,
    rename: true,
    delete: false,
    restore: false,
    batchDownload: true,
    batchDelete: false,
    batchRestore: false,
    navigateFolders: true,
  },
  favorites: {
    download: true,
    share: true,
    favorite: true,
    rename: true,
    delete: false,
    restore: false,
    batchDownload: true,
    batchDelete: false,
    batchRestore: false,
    navigateFolders: true,
  },
  trash: {
    download: false,
    share: false,
    favorite: false,
    rename: false,
    delete: false,
    restore: true,
    batchDownload: false,
    batchDelete: true,
    batchRestore: true,
    navigateFolders: false,
  },
};

interface CollectionProps {
  readonly mode: DriveListSource;
  readonly userId: string;
  readonly query: UseQueryResult<readonly DriveEntry[]>;
  readonly onPreviewEntry?: ((entry: DriveEntry) => void) | undefined;
}

function Collection({ mode, userId, query, onPreviewEntry }: CollectionProps) {
  const { t } = useTranslation("drive");

  const updateEntry = useUpdateDriveEntry();
  const restoreEntry = useRestoreDriveEntry();
  const permanentDelete = useDeleteDriveEntryPermanently();

  // Page-driven dialogs are scoped to this collection (the page only forwards a
  // preview callback), so share/rename dialogs are owned and rendered here.
  const [shareEntry, setShareEntry] = useState<DriveEntry | null>(null);
  const [renameEntry, setRenameEntry] = useState<DriveEntry | null>(null);

  // Opening a folder browses it in place: the flat collection is replaced by
  // the folder's children, with a breadcrumb rooted at the collection title.
  const [folderStack, setFolderStack] = useState<readonly { readonly id: string; readonly name: string }[]>([]);
  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const inFolder = folderStack.length > 0;
  const folderQuery = useDriveEntries(currentFolderId, "normal", { ownerType: "user", ownerId: userId });
  const activeQuery = inFolder ? folderQuery : query;

  const entries = useMemo(() => activeQuery.data ?? [], [activeQuery.data]);
  const items = useMemo(() => entries.map(entryToDisplayItem), [entries]);
  const entryById = useMemo(
    () => new Map(entries.map(entry => [entry.id, entry])),
    [entries],
  );
  const entryByFileId = useMemo(
    () => new Map(entries.filter(entry => entry.file).map(entry => [entry.file!.fileId, entry])),
    [entries],
  );

  const config = COLLECTION_TOOLBAR[mode];
  const toolbar: ToolbarConfig = inFolder
    ? {
      kind: "folder",
      ownerType: "user",
      folderPath: [{ id: null, name: t(config.titleKey) }, ...folderStack],
      showCreateActions: false,
      // folderPath[0] is the collection root; index>0 maps to folderStack[i-1].
      onNavigateToBreadcrumb: index => setFolderStack(prev => (index <= 0 ? [] : prev.slice(0, index))),
    } satisfies FolderToolbarConfig
    : {
      kind: "collection",
      titleKey: config.titleKey,
      emptyIcon: config.emptyIcon,
      emptyTitleKey: config.emptyTitleKey,
      emptyDescKey: config.emptyDescKey,
    } satisfies CollectionToolbarConfig;

  const isTrash = mode === "trash";

  const actions: DriveFileListSurfaceActions = useMemo(() => ({
    onRefresh: () => void activeQuery.refetch(),
    onNavigateToFolder: (folderId, folderName) => setFolderStack(prev => [...prev, { id: folderId, name: folderName }]),
    onDownload: (fileId) => {
      const entry = entryByFileId.get(fileId);
      if (entry)
        void downloadDriveEntry(entry);
    },
    onShare: (entryId) => {
      const entry = entryById.get(entryId);
      if (entry)
        setShareEntry(entry);
    },
    // Permanent deletion is wired for trash only; recent/favorites disable the
    // delete capabilities, so these stay no-ops there to guard live entries.
    onDelete: isTrash ? id => permanentDelete.mutate(id) : () => {},
    onBatchDelete: isTrash
      ? (ids) => {
          for (const id of ids)
            permanentDelete.mutate(id);
        }
      : () => {},
    ...(isTrash
      ? {
          onRestore: (id: string) => restoreEntry.mutate(id),
          onBatchRestore: (ids: Set<string>) => {
            for (const id of ids)
              restoreEntry.mutate(id);
          },
          getCustomActions: (): FileListAction[] => [
            {
              key: "permanent-delete",
              label: t("browser.action.deleteForever"),
              icon: <Trash2 className="mr-2 size-4" />,
              variant: "destructive",
              onSelect: target => permanentDelete.mutate(target.id),
            },
          ],
        }
      : {}),
    onPreview: (item) => {
      const entry = entryById.get(item.id);
      if (entry)
        onPreviewEntry?.(entry);
    },
    onRename: (item) => {
      const entry = entryById.get(item.id);
      if (entry)
        setRenameEntry(entry);
    },
    onFavoriteChange: (item, favorite) => updateEntry.mutate({ id: item.id, favorite }),
  }), [activeQuery, entryById, entryByFileId, isTrash, onPreviewEntry, permanentDelete, restoreEntry, t, updateEntry]);

  const error = activeQuery.error ?? updateEntry.error ?? restoreEntry.error ?? permanentDelete.error;

  return (
    <>
      <DriveFileListSurface
        items={items}
        loading={activeQuery.isLoading}
        toolbar={toolbar}
        capabilities={COLLECTION_CAPABILITIES[mode]}
        actions={actions}
        viewModeStorageKey={`drive.collectionViewMode.${mode}`}
        banner={error ? <div className="px-4 pt-2"><ErrorBanner message={error.message} /></div> : undefined}
      />

      {shareEntry && (
        <ShareDialog
          entry={shareEntry}
          open
          onOpenChange={open => !open && setShareEntry(null)}
        />
      )}
      <RenameDialog
        open={renameEntry !== null}
        onOpenChange={open => !open && setRenameEntry(null)}
        entry={renameEntry}
        pending={updateEntry.isPending}
        onRename={(name) => {
          if (renameEntry)
            updateEntry.mutate({ id: renameEntry.id, name }, { onSuccess: () => setRenameEntry(null) });
        }}
      />
    </>
  );
}
