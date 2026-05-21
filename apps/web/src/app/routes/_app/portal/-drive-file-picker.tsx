// Reusable drive file picker. A modal that browses the caller's drive (or a
// team directory when an owner is supplied), lets folders be navigated, and
// returns the chosen file entry via `onPick`. Built so other modules can
// attach a drive file (e.g. as an item-attachment proxy).
//
// Import path: @/app/routes/_app/portal/-drive-file-picker

import type { DriveEntry, DriveOwnerType } from "@/shared/lib/api/drive";

import { ChevronRight, FileText, Folder } from "lucide-react";
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
import { useDriveEntries } from "@/shared/lib/api/drive";

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

  const enterFolder = (entry: DriveEntry) =>
    setFolderStack(prev => [...prev, { id: entry.id, name: entry.name }]);
  const showRoot = () => setFolderStack([]);
  const showCrumb = (index: number) => setFolderStack(prev => prev.slice(0, index + 1));

  const selectFile = (entry: DriveEntry) => {
    onPick(entry);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("drive:picker.title")}</DialogTitle>
          <DialogDescription>{t("drive:picker.description")}</DialogDescription>
        </DialogHeader>

        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <button type="button" className="truncate rounded px-1 hover:text-foreground" onClick={showRoot}>
            {t("drive:picker.root")}
          </button>
          {folderStack.map((crumb, index) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0" />
              <button
                type="button"
                className="truncate rounded px-1 hover:text-foreground"
                onClick={() => showCrumb(index)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {entriesQuery.isLoading && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("common:common.loading")}</p>
          )}
          {entriesQuery.error && (
            <p className="px-3 py-6 text-center text-sm text-destructive">{entriesQuery.error.message}</p>
          )}
          {!entriesQuery.isLoading && !entriesQuery.error && entries.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("drive:picker.empty")}</p>
          )}
          <ul className="divide-y divide-border">
            {entries.map(entry => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                  onClick={() => (entry.type === "folder" ? enterFolder(entry) : selectFile(entry))}
                >
                  {entry.type === "folder"
                    ? <Folder className="size-4 shrink-0 text-primary" />
                    : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{entry.name}</span>
                  {entry.type === "folder" && <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
