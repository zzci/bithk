import type { DriveSelection } from "./-use-drive-selection";
import type { DriveEntry, DriveEntryStatus } from "@/shared/lib/api/drive";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import {
  CheckIcon,
  Download,
  Eye,
  FileText,
  Folder,
  FolderInput,
  Link as LinkIcon,
  MinusIcon,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";

import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { cn } from "@/shared/lib/utils";

export interface FileListProps {
  readonly entries: readonly DriveEntry[];
  readonly status: DriveEntryStatus;
  readonly loading: boolean;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly selection: DriveSelection;
  readonly onOpenFolder: (entry: DriveEntry) => void;
  readonly onRename: (entry: DriveEntry) => void;
  readonly onMove: (entry: DriveEntry) => void;
  readonly onFavoriteToggle: (entry: DriveEntry) => void;
  readonly onDownload: (entry: DriveEntry) => void;
  readonly onShare?: ((entry: DriveEntry) => void) | undefined;
  readonly onPreview?: ((entry: DriveEntry) => void) | undefined;
  readonly onCopyLink?: ((entry: DriveEntry) => void) | undefined;
  readonly onTrash: (entry: DriveEntry) => void;
  readonly onRestore: (entry: DriveEntry) => void;
  readonly onPermanentDelete: (entry: DriveEntry) => void;
  readonly onBulkTrash: () => void;
}

export function FileList(props: FileListProps) {
  const { t } = useTranslation("drive");
  const { entries, status, loading, canManage, busy, selection } = props;
  const isTrash = status === "trash";

  const sorted = useMemo(() => sortEntries(entries), [entries]);
  const allIds = useMemo(() => sorted.map(entry => entry.id), [sorted]);

  const selectedCount = selection.count;
  const allSelected = allIds.length > 0 && allIds.every(id => selection.isSelected(id));
  const someSelected = selectedCount > 0 && !allSelected;
  const columnCount = canManage ? 5 : 4;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {canManage && !isTrash && selectedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm">
          <span className="font-medium">{t("browser.selectedCount", { count: selectedCount })}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={selection.clear}>
              {t("browser.clearSelection")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={props.onBulkTrash}
            >
              <Trash2 />
              {t("browser.action.trash")}
            </Button>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {canManage && (
              <TableHead className="w-10">
                <SelectionCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={allIds.length === 0}
                  label={t("browser.selectAll")}
                  onCheckedChange={checked => selection.setAll(checked, allIds)}
                />
              </TableHead>
            )}
            <TableHead>{t("browser.column.name")}</TableHead>
            <TableHead className="hidden w-36 md:table-cell">{t("browser.column.size")}</TableHead>
            <TableHead className="hidden w-48 md:table-cell">{t("browser.column.updated")}</TableHead>
            <TableHead className="w-12 text-right">{t("browser.column.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={columnCount} className="h-24 p-0">
                <CenteredHint>{t("common.loading")}</CenteredHint>
              </TableCell>
            </TableRow>
          )}
          {!loading && sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={columnCount} className="h-24 p-0">
                <CenteredHint>
                  {isTrash ? t("browser.empty.trash") : t("browser.empty.folder")}
                </CenteredHint>
              </TableCell>
            </TableRow>
          )}
          {sorted.map(entry => (
            <FileRow
              key={entry.id}
              entry={entry}
              isTrash={isTrash}
              canManage={canManage}
              busy={busy}
              selected={selection.isSelected(entry.id)}
              onToggleSelect={() => selection.toggle(entry.id)}
              onOpenFolder={props.onOpenFolder}
              onRename={props.onRename}
              onMove={props.onMove}
              onFavoriteToggle={props.onFavoriteToggle}
              onDownload={props.onDownload}
              onShare={props.onShare}
              onPreview={props.onPreview}
              onCopyLink={props.onCopyLink}
              onTrash={props.onTrash}
              onRestore={props.onRestore}
              onPermanentDelete={props.onPermanentDelete}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface FileRowProps {
  readonly entry: DriveEntry;
  readonly isTrash: boolean;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly selected: boolean;
  readonly onToggleSelect: () => void;
  readonly onOpenFolder: (entry: DriveEntry) => void;
  readonly onRename: (entry: DriveEntry) => void;
  readonly onMove: (entry: DriveEntry) => void;
  readonly onFavoriteToggle: (entry: DriveEntry) => void;
  readonly onDownload: (entry: DriveEntry) => void;
  readonly onShare?: ((entry: DriveEntry) => void) | undefined;
  readonly onPreview?: ((entry: DriveEntry) => void) | undefined;
  readonly onCopyLink?: ((entry: DriveEntry) => void) | undefined;
  readonly onTrash: (entry: DriveEntry) => void;
  readonly onRestore: (entry: DriveEntry) => void;
  readonly onPermanentDelete: (entry: DriveEntry) => void;
}

function FileRow(props: FileRowProps) {
  const { t } = useTranslation("drive");
  const { entry, isTrash, canManage } = props;
  const isFolder = entry.type === "folder";
  const canOpen = isFolder && !isTrash;

  return (
    <TableRow
      data-state={props.selected ? "selected" : undefined}
      onDoubleClick={() => canOpen && props.onOpenFolder(entry)}
    >
      {canManage && (
        <TableCell className="w-10">
          <SelectionCheckbox
            checked={props.selected}
            disabled={isTrash}
            label={t("browser.selectEntry", { name: entry.name })}
            onCheckedChange={props.onToggleSelect}
          />
        </TableCell>
      )}
      <TableCell className="min-w-0">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:text-inherit"
          disabled={!canOpen}
          onClick={() => (canOpen ? props.onOpenFolder(entry) : props.onPreview?.(entry))}
        >
          {isFolder
            ? <Folder className="size-4 shrink-0 text-primary" />
            : <FileText className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{entry.name}</span>
          {entry.favorite && <Star className="size-3 shrink-0 fill-current text-amber-500" />}
        </button>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {entry.file ? formatBytes(entry.file.size) : "—"}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {formatDate(entry.updatedAt)}
      </TableCell>
      <TableCell className="text-right">
        <RowActions {...props} />
      </TableCell>
    </TableRow>
  );
}

function RowActions(props: FileRowProps) {
  const { t } = useTranslation("drive");
  const { entry, isTrash, canManage, busy } = props;
  const isFile = entry.type === "file";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t("browser.action.more")}
            disabled={busy}
          />
        )}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {isTrash
          ? (
              <>
                <DropdownMenuItem disabled={!canManage} onClick={() => props.onRestore(entry)}>
                  <RotateCcw />
                  {t("browser.action.restore")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!canManage}
                  onClick={() => props.onPermanentDelete(entry)}
                >
                  <Trash2 />
                  {t("browser.action.deleteForever")}
                </DropdownMenuItem>
              </>
            )
          : (
              <>
                {isFile && (
                  <DropdownMenuItem onClick={() => props.onPreview?.(entry)}>
                    <Eye />
                    {t("browser.action.preview")}
                  </DropdownMenuItem>
                )}
                {isFile && (
                  <DropdownMenuItem onClick={() => props.onDownload(entry)}>
                    <Download />
                    {t("browser.action.download")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => props.onShare?.(entry)}>
                  <Share2 />
                  {t("browser.action.share")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => (props.onCopyLink ?? props.onShare)?.(entry)}>
                  <LinkIcon />
                  {t("browser.action.copyLink")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!canManage} onClick={() => props.onRename(entry)}>
                  <Pencil />
                  {t("browser.action.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canManage} onClick={() => props.onMove(entry)}>
                  <FolderInput />
                  {t("browser.action.move")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canManage} onClick={() => props.onFavoriteToggle(entry)}>
                  <Star className={cn(entry.favorite && "fill-current text-amber-500")} />
                  {entry.favorite ? t("browser.action.unfavorite") : t("browser.action.favorite")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!canManage}
                  onClick={() => props.onTrash(entry)}
                >
                  <Trash2 />
                  {t("browser.action.trash")}
                </DropdownMenuItem>
              </>
            )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly indeterminate?: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={value => onCheckedChange(value)}
      className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input text-primary-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {indeterminate ? <MinusIcon className="size-3" /> : <CheckIcon className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Folders first, then files; ties broken by case-insensitive name order. */
function sortEntries(entries: readonly DriveEntry[]): readonly DriveEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type)
      return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
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
