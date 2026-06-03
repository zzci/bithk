// Share inbox/outbox lists (Shared with me / Shared by me / Public links),
// rendered through the ONE shared `DriveFileListSurface` in collection mode.
// Each share row maps to a `DisplayItem`; share-specific behaviour (copy
// public link, revoke, download a received file) is injected through the
// surface's `getCustomActions` so the surface stays presentational and never
// learns about shares.
//
// Backed by the unified `share` API (shared/lib/api/share.ts): the same lists
// now surface shares of any resource type, not just drive entries.

import type {
  CollectionToolbarConfig,
  DriveFileListCapabilities,
  DriveFileListSurfaceActions,
  FileListAction,
  SurfaceExtraFilter,
} from "./-drive-file-list-surface";
import type { DisplayItem } from "./-file-browser-types";
import type { DriveEntry } from "@/shared/lib/api/drive";
import type { ShareView } from "@/shared/lib/api/share";
import { Copy, Download, Inbox, Link2, Share2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useClipboard, useVisibleUsers } from "@/shared/components/share/share-helpers";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { downloadDriveEntry } from "@/shared/lib/api/drive";
import {
  buildShareUrl,
  useLinkShares,
  useReceivedShares,
  useRevokeShare,
  useSentShares,
} from "@/shared/lib/api/share";
import { errorMessage } from "@/shared/lib/errors";
import { DriveFileListSurface } from "./-drive-file-list-surface";
import { detectFileType } from "./-file-browser-types";

// ── Surface-backed share list ──

type ShareListMode = "received" | "sent" | "links";

const COLLECTION_CONFIG: Record<ShareListMode, Pick<CollectionToolbarConfig, "titleKey" | "emptyTitleKey" | "emptyDescKey"> & { readonly emptyIcon: typeof Inbox }> = {
  received: {
    titleKey: "list.receivedTitle",
    emptyIcon: Inbox,
    emptyTitleKey: "empty.received",
    emptyDescKey: "emptyDesc.received",
  },
  sent: {
    titleKey: "list.sentTitle",
    emptyIcon: Share2,
    emptyTitleKey: "empty.sent",
    emptyDescKey: "emptyDesc.sent",
  },
  links: {
    titleKey: "list.linksTitle",
    emptyIcon: Link2,
    emptyTitleKey: "empty.links",
    emptyDescKey: "emptyDesc.links",
  },
};

/**
 * Capabilities are uniformly off — shares are listed read-only and every
 *  mutating action is injected through `getCustomActions`.
 */
const SHARE_CAPABILITIES: DriveFileListCapabilities = {
  download: false,
  share: false,
  favorite: false,
  rename: false,
  delete: false,
  batchDownload: false,
  batchDelete: false,
  navigateFolders: false,
  createFolder: false,
  upload: false,
  createTextFile: false,
};

function shareToDisplayItem(share: ShareView, ownerLabel: string): DisplayItem {
  return {
    id: share.id,
    name: share.resourceName,
    type: share.file ? detectFileType(share.file.mimetype) : "file",
    modified: share.updatedAt || share.createdAt,
    ownerType: "user",
    ownerId: share.createdBy,
    owner: ownerLabel,
    isFolder: share.isFolder,
    fileId: null,
    isFavorite: false,
    ...(share.file ? { size: share.file.size, mimeType: share.file.mimetype } : {}),
  };
}

/**
 * Reconstruct the minimal `DriveEntry` a drive share row stands for. The
 *  content / download endpoints authorize the caller through the share grant
 *  and key off the entry id, so this shape is enough for both preview and
 *  download. Only drive_entry shares produce a previewable entry.
 */
function shareToEntry(share: ShareView): DriveEntry {
  return {
    id: share.resourceId,
    ownerType: "user",
    ownerId: "",
    parentEntryId: null,
    type: "file",
    name: share.resourceName,
    favorite: false,
    status: "normal",
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    file: share.file ? { referenceId: "", fileId: "", ...share.file } : null,
  };
}

/** Download a drive file a recipient received via a share. */
function downloadReceivedShare(share: ShareView): void {
  void downloadDriveEntry(shareToEntry(share));
}

function ShareListSurface({
  mode,
  shares,
  loading,
  isError,
  error,
  onRefresh,
  extraFilters,
  onPreviewEntry,
}: {
  readonly mode: ShareListMode;
  readonly shares: readonly ShareView[];
  readonly loading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly onRefresh: () => void;
  readonly extraFilters?: readonly SurfaceExtraFilter[] | undefined;
  readonly onPreviewEntry?: ((entry: DriveEntry) => void) | undefined;
}) {
  const { t } = useTranslation("share");
  const revoke = useRevokeShare();
  const { copy } = useClipboard();
  const usersQuery = useVisibleUsers();

  const userNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of usersQuery.data ?? [])
      map.set(user.id, user.name || user.username);
    return map;
  }, [usersQuery.data]);

  const ownerLabel = useCallback((share: ShareView): string => {
    if (mode === "sent")
      return share.shareType === "public_link" ? t("publicLink") : (userNames.get(share.sharedWithUserId ?? "") ?? share.sharedWithUserId ?? "—");
    if (mode === "links")
      return t("publicLink");
    return userNames.get(share.createdBy) ?? share.createdBy;
  }, [mode, t, userNames]);

  const shareMap = useMemo(() => new Map(shares.map(share => [share.id, share])), [shares]);
  const items = useMemo(
    () => shares.map(share => shareToDisplayItem(share, ownerLabel(share))),
    [shares, ownerLabel],
  );

  // Only drive files preview / download in-app; document shares carry no
  // drive file and are skipped from the preview/download actions.
  const isDriveFile = (share: ShareView): boolean => share.resourceType === "drive_entry" && !!share.file;

  const getCustomActions = useCallback((item: DisplayItem): FileListAction[] => {
    const share = shareMap.get(item.id);
    if (!share)
      return [];

    if (mode === "received") {
      if (isDriveFile(share)) {
        return [{
          key: "download",
          label: t("action.download"),
          icon: <Download className="mr-2 size-4" />,
          onSelect: () => downloadReceivedShare(share),
        }];
      }
      return [];
    }

    const actions: FileListAction[] = [];
    if (share.shareType === "public_link") {
      actions.push({
        key: "copy-link",
        label: t("action.copyLink"),
        icon: <Copy className="mr-2 size-4" />,
        onSelect: () => copy(buildShareUrl(share.token)),
      });
    }
    actions.push({
      key: "revoke",
      label: t("action.revoke"),
      icon: <Trash2 className="mr-2 size-4" />,
      variant: "destructive",
      onSelect: () => revoke.mutate(share.id, {
        onError: err => toast.error(errorMessage(err, t("common.error.operationFailed", { ns: "common" }))),
      }),
    });
    return actions;
  }, [copy, mode, revoke, shareMap, t]);

  const config = COLLECTION_CONFIG[mode];
  const actions: DriveFileListSurfaceActions = {
    onRefresh,
    onNavigateToFolder: () => undefined,
    onDownload: () => undefined,
    onShare: () => undefined,
    onDelete: () => undefined,
    onBatchDelete: () => undefined,
    onPreview: (item) => {
      const share = shareMap.get(item.id);
      if (share && isDriveFile(share))
        onPreviewEntry?.(shareToEntry(share));
    },
    onRename: () => undefined,
    onFavoriteChange: () => undefined,
    getCustomActions,
  };

  // Surface a load failure through the surface's banner slot so an errored
  // fetch (shares=[]) is not silently rendered as the empty state.
  const banner = isError
    ? <ErrorBanner message={errorMessage(error, t("common.error.loadFailed", { ns: "common" }))} className="mb-3" />
    : undefined;

  return (
    <div className="flex h-full min-h-96 flex-col">
      <DriveFileListSurface
        items={items}
        loading={loading}
        banner={banner}
        viewModeStorageKey="drive.shareList.viewMode"
        toolbar={{
          kind: "collection",
          titleKey: config.titleKey,
          emptyIcon: config.emptyIcon,
          emptyTitleKey: config.emptyTitleKey,
          emptyDescKey: config.emptyDescKey,
        }}
        capabilities={SHARE_CAPABILITIES}
        actions={actions}
        extraFilters={extraFilters}
        i18nNs="share"
      />
    </div>
  );
}

// ── Public exports wired by the drive page ──

export function ReceivedSharesList({ onPreviewEntry }: {
  readonly onPreviewEntry?: ((entry: DriveEntry) => void) | undefined;
}) {
  const query = useReceivedShares();
  return (
    <ShareListSurface
      mode="received"
      shares={query.data ?? []}
      loading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRefresh={() => void query.refetch()}
      onPreviewEntry={onPreviewEntry}
    />
  );
}

type OutgoingCategory = "all" | "direct" | "public_link";

/**
 * "Shared by me" as a single list: direct shares + public links combined,
 * narrowed by an in-content "share category" filter (rendered in the surface
 * filter bar) rather than a separate top-of-page tab.
 */
export function OutgoingSharesList({ onPreviewEntry }: {
  readonly onPreviewEntry?: ((entry: DriveEntry) => void) | undefined;
}) {
  const { t } = useTranslation("share");
  const sentQuery = useSentShares();
  const linksQuery = useLinkShares();
  const [category, setCategory] = useState<OutgoingCategory>("all");

  const allShares = useMemo(
    () => [...(sentQuery.data ?? []), ...(linksQuery.data ?? [])],
    [sentQuery.data, linksQuery.data],
  );
  const shares = useMemo(
    () => category === "all" ? allShares : allShares.filter(share => share.shareType === category),
    [allShares, category],
  );

  const extraFilters: SurfaceExtraFilter[] = [{
    label: t("categoryLabel"),
    value: category,
    options: [
      { value: "all", label: t("filterAll") },
      { value: "direct", label: t("type.direct") },
      { value: "public_link", label: t("type.public_link") },
    ],
    onChange: value => setCategory(value as OutgoingCategory),
  }];

  return (
    <ShareListSurface
      mode="sent"
      shares={shares}
      loading={sentQuery.isLoading || linksQuery.isLoading}
      isError={sentQuery.isError || linksQuery.isError}
      error={sentQuery.error ?? linksQuery.error}
      onRefresh={() => {
        void sentQuery.refetch();
        void linksQuery.refetch();
      }}
      extraFilters={extraFilters}
      onPreviewEntry={onPreviewEntry}
    />
  );
}
