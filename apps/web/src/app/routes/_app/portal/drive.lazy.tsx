/* eslint-disable react-refresh/only-export-components */
import type { ChangeEvent, FormEvent } from "react";
import type { DriveEntry } from "@/shared/lib/api/drive";
import { createLazyFileRoute } from "@tanstack/react-router";
import {
  Download,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  downloadDriveEntry,
  useCreateDriveFolder,
  useDeleteDriveEntryPermanently,
  useDriveEntries,
  useRestoreDriveEntry,
  useTrashDriveEntry,
  useUpdateDriveEntry,
  useUploadDriveFile,
} from "@/shared/lib/api/drive";

export const Route = createLazyFileRoute("/_app/portal/drive")({
  component: DrivePage,
});

type StatusMode = "normal" | "trash";
interface FolderCrumb {
  readonly id: string;
  readonly name: string;
}
type EntryDialogState
  = | { readonly type: "folder" }
    | { readonly type: "rename"; readonly entry: DriveEntry }
    | null;

function DrivePage() {
  const { t } = useTranslation(["drive", "common"]);
  const [status, setStatus] = useState<StatusMode>("normal");
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const [dialog, setDialog] = useState<EntryDialogState>(null);
  const [dialogName, setDialogName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const entriesQuery = useDriveEntries(currentFolderId, status);
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);

  const createFolder = useCreateDriveFolder();
  const uploadFile = useUploadDriveFile();
  const updateEntry = useUpdateDriveEntry();
  const trashEntry = useTrashDriveEntry();
  const restoreEntry = useRestoreDriveEntry();
  const permanentDelete = useDeleteDriveEntryPermanently();

  const isBusy = createFolder.isPending
    || uploadFile.isPending
    || updateEntry.isPending
    || trashEntry.isPending
    || restoreEntry.isPending
    || permanentDelete.isPending;

  const openCreateFolder = () => {
    setDialogName("");
    setDialog({ type: "folder" });
  };

  const openRename = (entry: DriveEntry) => {
    setDialogName(entry.name);
    setDialog({ type: "rename", entry });
  };

  const closeDialog = () => {
    setDialog(null);
    setDialogName("");
  };

  const submitDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = dialogName.trim();
    if (!dialog || !name)
      return;

    if (dialog.type === "folder") {
      createFolder.mutate({ name, parentEntryId: currentFolderId }, { onSuccess: closeDialog });
      return;
    }

    updateEntry.mutate({ id: dialog.entry.id, name }, { onSuccess: closeDialog });
  };

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file)
      return;
    uploadFile.mutate({ file, parentEntryId: currentFolderId });
  };

  const enterFolder = (entry: DriveEntry) => {
    if (entry.type !== "folder" || status !== "normal")
      return;
    setFolderStack(prev => [...prev, { id: entry.id, name: entry.name }]);
  };

  const showRoot = () => setFolderStack([]);
  const showCrumb = (index: number) => setFolderStack(prev => prev.slice(0, index + 1));

  const error = entriesQuery.error
    || createFolder.error
    || uploadFile.error
    || updateEntry.error
    || trashEntry.error
    || restoreEntry.error
    || permanentDelete.error;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">{t("drive:page.title")}</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant={status === "normal" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus("normal")}
            >
              {t("drive:toolbar.files")}
            </Button>
            <Button
              type="button"
              variant={status === "trash" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus("trash")}
            >
              {t("drive:toolbar.trash")}
            </Button>
            {status === "normal" && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={openCreateFolder}>
                  <FolderPlus className="size-4" />
                  {t("drive:toolbar.newFolder")}
                </Button>
                <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-4" />
                  {t("drive:toolbar.upload")}
                </Button>
              </>
            )}
          </div>
        </div>

        <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <button type="button" className="truncate rounded px-1 hover:text-foreground" onClick={showRoot}>
            {t("drive:breadcrumbs.root")}
          </button>
          {folderStack.map((crumb, index) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <span>/</span>
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
      </header>

      <input ref={fileInputRef} type="file" className="hidden" onChange={onUploadChange} />

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive md:px-6">
          {error.message}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto px-4 py-3 md:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("drive:table.name")}</TableHead>
              <TableHead className="hidden w-36 md:table-cell">{t("drive:table.size")}</TableHead>
              <TableHead className="hidden w-48 md:table-cell">{t("drive:table.updated")}</TableHead>
              <TableHead className="w-12 text-right">{t("drive:table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entriesQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  {t("common:common.loading")}
                </TableCell>
              </TableRow>
            )}
            {!entriesQuery.isLoading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  {status === "trash" ? t("drive:empty.trash") : t("drive:empty.folder")}
                </TableCell>
              </TableRow>
            )}
            {entries.map(entry => (
              <TableRow key={entry.id} onDoubleClick={() => enterFolder(entry)}>
                <TableCell className="min-w-0">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded text-left hover:text-foreground disabled:cursor-default disabled:hover:text-inherit"
                    disabled={entry.type !== "folder" || status !== "normal"}
                    onClick={() => enterFolder(entry)}
                  >
                    {entry.type === "folder"
                      ? <Folder className="size-4 shrink-0 text-primary" />
                      : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{entry.name}</span>
                    {entry.favorite && <Star className="size-3 shrink-0 fill-current text-amber-500" />}
                  </button>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {entry.file ? formatBytes(entry.file.size) : "-"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatDate(entry.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <EntryActions
                    entry={entry}
                    status={status}
                    disabled={isBusy}
                    onRename={() => openRename(entry)}
                    onFavorite={() => updateEntry.mutate({ id: entry.id, favorite: !entry.favorite })}
                    onDownload={() => void downloadDriveEntry(entry)}
                    onTrash={() => trashEntry.mutate(entry.id)}
                    onRestore={() => restoreEntry.mutate(entry.id)}
                    onPermanentDelete={() => permanentDelete.mutate(entry.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </main>

      <EntryDialog
        state={dialog}
        value={dialogName}
        pending={createFolder.isPending || updateEntry.isPending}
        onValueChange={setDialogName}
        onOpenChange={open => !open && closeDialog()}
        onSubmit={submitDialog}
      />
    </div>
  );
}

function EntryActions(props: {
  readonly entry: DriveEntry;
  readonly status: StatusMode;
  readonly disabled: boolean;
  readonly onRename: () => void;
  readonly onFavorite: () => void;
  readonly onDownload: () => void;
  readonly onTrash: () => void;
  readonly onRestore: () => void;
  readonly onPermanentDelete: () => void;
}) {
  const { t } = useTranslation("drive");
  const entry = props.entry;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("actions.more")} disabled={props.disabled} />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {props.status === "normal" && (
          <>
            {entry.type === "file" && (
              <DropdownMenuItem onClick={props.onDownload}>
                <Download className="size-4" />
                {t("actions.download")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={props.onRename}>
              <Pencil className="size-4" />
              {t("actions.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onFavorite}>
              <Star className="size-4" />
              {entry.favorite ? t("actions.unfavorite") : t("actions.favorite")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={props.onTrash}>
              <Trash2 className="size-4" />
              {t("actions.trash")}
            </DropdownMenuItem>
          </>
        )}
        {props.status === "trash" && (
          <>
            <DropdownMenuItem onClick={props.onRestore}>
              <RefreshCw className="size-4" />
              {t("actions.restore")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={props.onPermanentDelete}>
              <Trash2 className="size-4" />
              {t("actions.deleteForever")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EntryDialog(props: {
  readonly state: EntryDialogState;
  readonly value: string;
  readonly pending: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation(["drive", "common"]);
  const isRename = props.state?.type === "rename";

  return (
    <Dialog open={props.state !== null} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={props.onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isRename ? t("drive:dialog.renameTitle") : t("drive:dialog.folderTitle")}
            </DialogTitle>
            <DialogDescription>
              {isRename ? t("drive:dialog.renameDescription") : t("drive:dialog.folderDescription")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={props.value}
            onChange={event => props.onValueChange(event.currentTarget.value)}
            placeholder={t("drive:dialog.namePlaceholder")}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={props.pending || !props.value.trim()}>
              {props.pending ? t("common:common.saving") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(value: number): string {
  if (value < 1024)
    return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(next >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
