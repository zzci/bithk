// Reusable drive file picker. A modal that browses the caller's drive (or a
// team directory when an owner is supplied), lets folders be navigated, and
// returns the chosen file entry via `onPick`. Built so other modules can
// attach a drive file (e.g. as an item-attachment proxy).
//
// Browsing + navigation is delegated to the shared `DriveFileListSurface` in
// its compact variant: the picker only feeds it items and resolves itself when
// a file is opened. It exposes the navigate-folders capability alone — picking
// a file, not managing the drive.
//
// Import path: @/app/routes/_app/portal/-drive-file-picker

import type { DriveFileListCapabilities, DriveFileListSurfaceActions, FolderToolbarConfig } from "./-drive-file-list-surface";
import type { DisplayItem } from "./-file-browser-types";
import type { DriveEntry, DriveOwnerType } from "@/shared/lib/api/drive";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDriveEntries } from "@/shared/lib/api/drive";
import { DriveFileListSurface } from "./-drive-file-list-surface";
import { entryToDisplayItem } from "./-file-browser-types";

interface FolderCrumb {
  readonly id: string;
  readonly name: string;
}

interface DriveFilePickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (entry: DriveEntry) => void;
  readonly ownerType?: DriveOwnerType | undefined;
  readonly ownerId?: string | undefined;
}

// Browsing only — no create/upload/share/delete/favorite/rename affordances.
const PICKER_CAPABILITIES: DriveFileListCapabilities = {
  navigateFolders: true,
  download: false,
  share: false,
  favorite: false,
  rename: false,
  delete: false,
  restore: false,
  batchDownload: false,
  batchDelete: false,
  batchRestore: false,
  createFolder: false,
  upload: false,
  createTextFile: false,
};

export function DriveFilePicker({ open, onOpenChange, onPick, ownerType, ownerId }: DriveFilePickerProps) {
  const { t } = useTranslation(["drive", "common"]);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);

  // Reset navigation each time the picker is reopened so it always starts at
  // the owner's root.
  useEffect(() => {
    if (!open)
      setFolderStack([]);
  }, [open]);

  const owner = ownerType && ownerId ? { ownerType, ownerId } : undefined;
  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const entriesQuery = useDriveEntries(currentFolderId, "normal", owner);
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const items = useMemo(() => entries.map(entryToDisplayItem), [entries]);

  const folderPath = useMemo<FolderToolbarConfig["folderPath"]>(
    () => [
      { id: null, name: t("picker.root") },
      ...folderStack.map(crumb => ({ id: crumb.id, name: crumb.name })),
    ],
    [folderStack, t],
  );

  const toolbar: FolderToolbarConfig = {
    kind: "folder",
    variant: "compact",
    ownerType: ownerType === "team_directory" ? "team" : "user",
    folderPath,
    showCreateActions: false,
    onNavigateToBreadcrumb: index => setFolderStack(prev => prev.slice(0, index)),
  };

  // Opening a file (surface double-click / preview path) is how the picker
  // resolves: surface a folder via navigation, resolve the picker on a file.
  const pickEntry = (item: DisplayItem) => {
    const entry = entries.find(candidate => candidate.id === item.id);
    if (entry) {
      onPick(entry);
      onOpenChange(false);
    }
  };

  const noop = () => {};
  const actions: DriveFileListSurfaceActions = {
    onRefresh: () => void entriesQuery.refetch(),
    onNavigateToFolder: (entryId, folderName) =>
      setFolderStack(prev => [...prev, { id: entryId, name: folderName }]),
    onPreview: pickEntry,
    onDownload: noop,
    onShare: noop,
    onDelete: noop,
    onBatchDelete: noop,
    onRename: noop,
    onFavoriteChange: noop,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{t("picker.title")}</DialogTitle>
          <DialogDescription>{t("picker.description")}</DialogDescription>
        </DialogHeader>

        <div className="h-[60vh] min-h-0 flex-1 border-y border-border">
          <DriveFileListSurface
            items={items}
            loading={entriesQuery.isLoading}
            toolbar={toolbar}
            capabilities={PICKER_CAPABILITIES}
            actions={actions}
            banner={<ErrorBanner message={entriesQuery.error?.message} className="mx-4 mt-2" />}
          />
        </div>

        <DialogFooter className="px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
