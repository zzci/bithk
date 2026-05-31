import type { FileListAction } from "./-drive-file-list-types";
// Per-item action renderers for the drive file-list inner list/grid:
// the "more actions" dropdown, the row hover toolbar, and the right-click
// context menu. Extracted from `-drive-file-list-inner.tsx`; behaviour and
// markup are unchanged — the inner list passes its handlers/flags as props.
import type { DisplayItem } from "./-file-browser-types";
import {
  Download,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  ContextMenuContent,
  ContextMenuItem,
} from "@/shared/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

export interface ItemActionsContext {
  readonly isMultiSelectionActive: boolean;
  readonly canDelete: boolean;
  readonly canDownload: boolean;
  readonly canRename: boolean;
  readonly canShare: boolean;
  readonly canFavorite: boolean;
  readonly canRestore: boolean;
  readonly onDownload: (fileId: string, fileName: string) => void;
  readonly onShare: (entryId: string, name: string) => void;
  readonly onRestore?: ((entryId: string) => void) | undefined;
  readonly onBatchRestore?: (() => void) | undefined;
  readonly onBatchDownload: () => void;
  readonly onRename: (item: DisplayItem) => void;
  readonly onFavoriteChange: (item: DisplayItem, favorite: boolean) => void;
  readonly onContextDelete: (item: DisplayItem) => void;
  readonly onBatchDelete: () => void;
  readonly getCustomActions?: ((item: DisplayItem) => FileListAction[]) | undefined;
}

const actionButtonClass = "size-8 rounded-full text-muted-foreground hover:text-foreground";

export function ItemMenu({ item, ctx }: { readonly item: DisplayItem; readonly ctx: ItemActionsContext }) {
  const { t } = useTranslation("drive");
  const {
    isMultiSelectionActive,
    canDelete,
    canDownload,
    canRename,
    canShare,
    canFavorite,
    canRestore,
    onDownload,
    onShare,
    onRestore,
    onBatchRestore,
    onBatchDownload,
    onRename,
    onFavoriteChange,
    onContextDelete,
    getCustomActions,
  } = ctx;
  const customActions = getCustomActions?.(item) ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            aria-label={t("browser.action.more")}
            onClick={e => e.stopPropagation()}
          />
        )}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isMultiSelectionActive
          ? (
              <>
                {canDownload && (
                  <DropdownMenuItem onClick={onBatchDownload}>
                    <Download className="mr-2 size-4" />
                    {t("browser.action.download")}
                  </DropdownMenuItem>
                )}
                {canRestore && onBatchRestore && (
                  <DropdownMenuItem onClick={onBatchRestore}>
                    <RotateCcw className="mr-2 size-4" />
                    {t("browser.action.restore")}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onClick={() => onContextDelete(item)}>
                    <Trash2 className="mr-2 size-4" />
                    {t("browser.deleteSelected")}
                  </DropdownMenuItem>
                )}
              </>
            )
          : (
              <>
                {canDownload && !item.isFolder && item.fileId && (
                  <DropdownMenuItem onClick={() => onDownload(item.fileId!, item.name)}>
                    <Download className="mr-2 size-4" />
                    {t("browser.action.download")}
                  </DropdownMenuItem>
                )}
                {canShare && (item.fileId || item.isFolder) && (
                  <DropdownMenuItem onClick={() => onShare(item.id, item.name)}>
                    <Share2 className="mr-2 size-4" />
                    {t("browser.action.share")}
                  </DropdownMenuItem>
                )}
                {canRestore && onRestore && (
                  <DropdownMenuItem onClick={() => onRestore(item.id)}>
                    <RotateCcw className="mr-2 size-4" />
                    {t("browser.action.restore")}
                  </DropdownMenuItem>
                )}
                {canFavorite && !canRestore && (
                  <DropdownMenuItem onClick={() => onFavoriteChange(item, !item.isFavorite)}>
                    <Star className={cn("mr-2 size-4", item.isFavorite && "fill-current text-amber-500")} />
                    {t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
                  </DropdownMenuItem>
                )}
                {canRename && (
                  <DropdownMenuItem onClick={() => onRename(item)}>
                    <Pencil className="mr-2 size-4" />
                    {t("browser.action.rename")}
                  </DropdownMenuItem>
                )}
                {customActions.map(action => (
                  <DropdownMenuItem
                    key={action.key}
                    variant={action.variant ?? "default"}
                    onClick={() => action.onSelect(item)}
                  >
                    {action.icon}
                    {action.label}
                  </DropdownMenuItem>
                ))}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onClick={() => onContextDelete(item)}>
                    <Trash2 className="mr-2 size-4" />
                    {t("browser.action.trash")}
                  </DropdownMenuItem>
                )}
              </>
            )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ItemHoverToolbar({ item, ctx }: { readonly item: DisplayItem; readonly ctx: ItemActionsContext }) {
  const { t } = useTranslation("drive");
  const {
    isMultiSelectionActive,
    canDelete,
    canDownload,
    canRename,
    canShare,
    canFavorite,
    canRestore,
    onDownload,
    onShare,
    onBatchRestore,
    onBatchDownload,
    onRename,
    onFavoriteChange,
    onBatchDelete,
  } = ctx;

  if (isMultiSelectionActive) {
    return (
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 @max-[980px]:hidden">
        {canDownload && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            title={t("browser.action.download")}
            aria-label={t("browser.action.download")}
            onClick={(event) => {
              event.stopPropagation();
              onBatchDownload();
            }}
          >
            <Download className="size-4" />
          </Button>
        )}
        {canRestore && onBatchRestore && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            title={t("browser.action.restore")}
            aria-label={t("browser.action.restore")}
            onClick={(event) => {
              event.stopPropagation();
              onBatchRestore();
            }}
          >
            <RotateCcw className="size-4" />
          </Button>
        )}
        {canDelete && (
          <Button
            data-drive-action
            variant="ghost"
            size="icon"
            className={cn(actionButtonClass, "text-destructive hover:text-destructive")}
            title={t("browser.deleteSelected")}
            aria-label={t("browser.deleteSelected")}
            onClick={(event) => {
              event.stopPropagation();
              onBatchDelete();
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 @max-[980px]:hidden">
      {canShare && (item.fileId || item.isFolder) && (
        <Button
          data-drive-action
          variant="ghost"
          size="icon"
          className={actionButtonClass}
          title={t("browser.action.share")}
          aria-label={t("browser.action.share")}
          onClick={(event) => {
            event.stopPropagation();
            onShare(item.id, item.name);
          }}
        >
          <Share2 className="size-4" />
        </Button>
      )}
      {canDownload && !item.isFolder && item.fileId && (
        <Button
          data-drive-action
          variant="ghost"
          size="icon"
          className={actionButtonClass}
          title={t("browser.action.download")}
          aria-label={t("browser.action.download")}
          onClick={(event) => {
            event.stopPropagation();
            onDownload(item.fileId!, item.name);
          }}
        >
          <Download className="size-4" />
        </Button>
      )}
      {canRename && (
        <Button
          data-drive-action
          variant="ghost"
          size="icon"
          className={actionButtonClass}
          title={t("browser.action.rename")}
          aria-label={t("browser.action.rename")}
          onClick={(event) => {
            event.stopPropagation();
            onRename(item);
          }}
        >
          <Pencil className="size-4" />
        </Button>
      )}
      {canFavorite && !canRestore && (
        <Button
          data-drive-action
          variant="ghost"
          size="icon"
          className={cn(actionButtonClass, item.isFavorite && "text-amber-500 hover:text-amber-600")}
          title={t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
          aria-label={t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
          onClick={(event) => {
            event.stopPropagation();
            onFavoriteChange(item, !item.isFavorite);
          }}
        >
          <Star className={cn("size-4", item.isFavorite && "fill-current")} />
        </Button>
      )}
    </div>
  );
}

export function ItemContextMenu({ item, ctx }: { readonly item: DisplayItem; readonly ctx: ItemActionsContext }) {
  const { t } = useTranslation("drive");
  const {
    isMultiSelectionActive,
    canDelete,
    canDownload,
    canRename,
    canShare,
    canFavorite,
    canRestore,
    onDownload,
    onShare,
    onRestore,
    onBatchRestore,
    onBatchDownload,
    onRename,
    onFavoriteChange,
    onContextDelete,
    getCustomActions,
  } = ctx;
  const customActions = getCustomActions?.(item) ?? [];
  return (
    <ContextMenuContent>
      {isMultiSelectionActive
        ? (
            <>
              {canDownload && (
                <ContextMenuItem onClick={onBatchDownload}>
                  <Download className="mr-2 size-4" />
                  {t("browser.action.download")}
                </ContextMenuItem>
              )}
              {canRestore && onBatchRestore && (
                <ContextMenuItem onClick={onBatchRestore}>
                  <RotateCcw className="mr-2 size-4" />
                  {t("browser.action.restore")}
                </ContextMenuItem>
              )}
              {canDelete && (
                <ContextMenuItem variant="destructive" onClick={() => onContextDelete(item)}>
                  <Trash2 className="mr-2 size-4" />
                  {t("browser.deleteSelected")}
                </ContextMenuItem>
              )}
            </>
          )
        : (
            <>
              {canDownload && !item.isFolder && item.fileId && (
                <ContextMenuItem onClick={() => onDownload(item.fileId!, item.name)}>
                  <Download className="mr-2 size-4" />
                  {t("browser.action.download")}
                </ContextMenuItem>
              )}
              {canShare && (item.fileId || item.isFolder) && (
                <ContextMenuItem onClick={() => onShare(item.id, item.name)}>
                  <Share2 className="mr-2 size-4" />
                  {t("browser.action.share")}
                </ContextMenuItem>
              )}
              {canRestore && onRestore && (
                <ContextMenuItem onClick={() => onRestore(item.id)}>
                  <RotateCcw className="mr-2 size-4" />
                  {t("browser.action.restore")}
                </ContextMenuItem>
              )}
              {canFavorite && !canRestore && (
                <ContextMenuItem onClick={() => onFavoriteChange(item, !item.isFavorite)}>
                  <Star className={cn("mr-2 size-4", item.isFavorite && "fill-current text-amber-500")} />
                  {t(item.isFavorite ? "browser.action.unfavorite" : "browser.action.favorite")}
                </ContextMenuItem>
              )}
              {canRename && (
                <ContextMenuItem onClick={() => onRename(item)}>
                  <Pencil className="mr-2 size-4" />
                  {t("browser.action.rename")}
                </ContextMenuItem>
              )}
              {customActions.map(action => (
                <ContextMenuItem
                  key={action.key}
                  variant={action.variant ?? "default"}
                  onClick={() => action.onSelect(item)}
                >
                  {action.icon}
                  {action.label}
                </ContextMenuItem>
              ))}
              {canDelete && (
                <ContextMenuItem variant="destructive" onClick={() => onContextDelete(item)}>
                  <Trash2 className="mr-2 size-4" />
                  {t("browser.action.trash")}
                </ContextMenuItem>
              )}
            </>
          )}
    </ContextMenuContent>
  );
}
