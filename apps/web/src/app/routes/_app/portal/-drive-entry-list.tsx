// Flat, read-mostly entry list for the sidebar-driven "recent", "favorites",
// and "trash" drive views. The folder-navigation browser lives in
// -file-browser.tsx; this is the lighter list the original project used for
// these aggregate views.

import type { UseQueryResult } from "@tanstack/react-query";
import type { DriveEntry } from "@/shared/lib/api/drive";
import {
  Clock,
  Download,
  Eye,
  FileText,
  Folder,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  downloadDriveEntry,
  useDeleteDriveEntryPermanently,
  useDriveEntries,
  useFavoriteEntries,
  useRecentEntries,
  useRestoreDriveEntry,
  useUpdateDriveEntry,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";
import { formatBytes, formatDate } from "./-share-lists";

export type DriveListSource = "recent" | "favorites" | "trash";

const EMPTY_ICON: Record<DriveListSource, typeof Clock> = {
  recent: Clock,
  favorites: Star,
  trash: Trash2,
};

interface ListProps {
  readonly source: DriveListSource;
  readonly userId: string;
  readonly onPreviewEntry?: ((entry: DriveEntry) => void) | undefined;
}

// One fetch wrapper per source so only the active view's query runs (React
// forbids calling the other hooks conditionally).
export function DriveEntryListView({ source, userId, onPreviewEntry }: ListProps) {
  if (source === "recent")
    return <RecentList source={source} userId={userId} onPreviewEntry={onPreviewEntry} />;
  if (source === "favorites")
    return <FavoritesList source={source} userId={userId} onPreviewEntry={onPreviewEntry} />;
  return <TrashList source={source} userId={userId} onPreviewEntry={onPreviewEntry} />;
}

function RecentList(props: ListProps) {
  return <EntryList {...props} query={useRecentEntries()} />;
}

function FavoritesList(props: ListProps) {
  return <EntryList {...props} query={useFavoriteEntries()} />;
}

function TrashList(props: ListProps) {
  const query = useDriveEntries(null, "trash", { ownerType: "user", ownerId: props.userId });
  return <EntryList {...props} query={query} />;
}

function EntryList({
  source,
  onPreviewEntry,
  query,
}: ListProps & { readonly query: UseQueryResult<readonly DriveEntry[]> }) {
  const { t } = useTranslation("drive");

  const updateEntry = useUpdateDriveEntry();
  const restoreEntry = useRestoreDriveEntry();
  const permanentDelete = useDeleteDriveEntryPermanently();

  const entries = query.data ?? [];
  const isTrash = source === "trash";
  const EmptyIcon = EMPTY_ICON[source];

  if (query.isLoading && entries.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <EmptyIcon className="size-9 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">
          {t(`sidebar.empty.${source}`)}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(entry => (
        <li
          key={entry.id}
          className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {entry.type === "folder"
              ? <Folder className="size-4" strokeWidth={1.75} />
              : <FileText className="size-4" strokeWidth={1.75} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{entry.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {entry.file ? `${formatBytes(entry.file.size)} · ` : ""}
              {formatDate(entry.updatedAt)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            {isTrash
              ? (
                  <>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={restoreEntry.isPending}
                      title={t("browser.action.restore")}
                      onClick={() => restoreEntry.mutate(entry.id)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={permanentDelete.isPending}
                      title={t("browser.action.deleteForever")}
                      onClick={() => permanentDelete.mutate(entry.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </>
                )
              : (
                  <>
                    {entry.type === "file" && onPreviewEntry && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={t("browser.action.preview")}
                        onClick={() => onPreviewEntry(entry)}
                      >
                        <Eye className="size-4" />
                      </Button>
                    )}
                    {entry.type === "file" && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={t("browser.action.download")}
                        onClick={() => void downloadDriveEntry(entry)}
                      >
                        <Download className="size-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={updateEntry.isPending}
                      title={entry.favorite ? t("browser.action.unfavorite") : t("browser.action.favorite")}
                      onClick={() => updateEntry.mutate({ id: entry.id, favorite: !entry.favorite })}
                    >
                      <Star className={cn("size-4", entry.favorite && "fill-current text-amber-500")} />
                    </Button>
                  </>
                )}
          </div>
        </li>
      ))}
    </ul>
  );
}
