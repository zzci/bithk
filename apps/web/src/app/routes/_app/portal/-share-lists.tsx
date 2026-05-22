/* eslint-disable react-refresh/only-export-components */
// Drive share lists + shared share-UI helpers.
//
// The three "share inbox/outbox" lists (Shared with me / Shared by me /
// Public links) all render through the ONE shared `DriveFileListSurface`
// in collection mode. Each share row maps to a `DisplayItem`; share-specific
// behaviour (copy public link, revoke, download a received file) is injected
// through the surface's `getCustomActions` so the surface itself stays
// presentational and never learns about shares.
//
// This module also exposes small primitives reused by `-share-dialog.tsx`
// and other drive views: the public-link URL builder, a clipboard hook, the
// visible-users picker source, and the byte/date formatters.

import type {
  CollectionToolbarConfig,
  DriveFileListCapabilities,
  DriveFileListSurfaceActions,
  FileListAction,
} from "./-drive-file-list-surface";
import type { DisplayItem } from "./-file-browser-types";
import type { SimpleUser } from "@/shared/lib/api/documents";
import type { DriveShare } from "@/shared/lib/api/drive";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Inbox, Link2, Share2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  downloadDriveEntry,
  usePublicLinks,
  useReceivedShares,
  useRevokeShare,
  useSentShares,
} from "@/shared/lib/api/drive";
import { http } from "@/shared/lib/http";
import { DriveFileListSurface } from "./-drive-file-list-surface";
import { detectFileType } from "./-file-browser-types";

// ── Shared helpers ──

/** Absolute, copy-ready URL for a public share token. */
export function buildPublicShareUrl(token: string): string {
  return `${window.location.origin}/drive/shared/${encodeURIComponent(token)}`;
}

/** Clipboard helper with a transient "copied" flag for button feedback. */
export function useClipboard(resetMs = 1500): {
  readonly copied: boolean;
  readonly copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(setCopied, resetMs, false);
    });
  }, [resetMs]);
  return { copied, copy };
}

/** Visible users for the direct-share / member pickers (shared client). */
export function useVisibleUsers() {
  return useQuery({
    queryKey: ["account", "visible-users"],
    queryFn: () => http<{ readonly data: readonly SimpleUser[] }>("/account/visible-users").then(r => r.data),
    staleTime: 30_000,
  });
}

export function formatBytes(value: number): string {
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

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// ── Surface-backed share list ──

type ShareListMode = "received" | "sent" | "links";

const COLLECTION_CONFIG: Record<ShareListMode, Pick<CollectionToolbarConfig, "titleKey" | "emptyTitleKey" | "emptyDescKey"> & { readonly emptyIcon: typeof Inbox }> = {
  received: {
    titleKey: "share.list.receivedTitle",
    emptyIcon: Inbox,
    emptyTitleKey: "share.empty.received",
    emptyDescKey: "share.emptyDesc.received",
  },
  sent: {
    titleKey: "share.list.sentTitle",
    emptyIcon: Share2,
    emptyTitleKey: "share.empty.sent",
    emptyDescKey: "share.emptyDesc.sent",
  },
  links: {
    titleKey: "share.list.linksTitle",
    emptyIcon: Link2,
    emptyTitleKey: "share.empty.links",
    emptyDescKey: "share.emptyDesc.links",
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

function shareToDisplayItem(share: DriveShare, ownerLabel: string): DisplayItem {
  return {
    id: share.id,
    name: share.entryName,
    type: share.file ? detectFileType(share.file.mimetype) : "file",
    modified: share.updatedAt || share.createdAt,
    ownerType: "user",
    ownerId: share.createdBy,
    owner: ownerLabel,
    isFolder: false,
    fileId: null,
    isFavorite: false,
    ...(share.file ? { size: share.file.size, mimeType: share.file.mimetype } : {}),
  };
}

/**
 * Download a file a recipient received via a share. The content endpoint
 *  authorizes the recipient through the share grant, so the minimal entry
 *  shape the downloader needs is reconstructed from the share view.
 */
function downloadReceivedShare(share: DriveShare): void {
  void downloadDriveEntry({
    id: share.driveEntryId,
    ownerType: "user",
    ownerId: "",
    parentEntryId: null,
    type: "file",
    name: share.entryName,
    favorite: false,
    status: "normal",
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    file: share.file ? { referenceId: "", fileId: "", ...share.file } : null,
  });
}

function ShareListSurface({
  mode,
  shares,
  loading,
  onRefresh,
}: {
  readonly mode: ShareListMode;
  readonly shares: readonly DriveShare[];
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  const { t } = useTranslation("drive");
  const revoke = useRevokeShare();
  const { copy } = useClipboard();
  const usersQuery = useVisibleUsers();

  const userNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of usersQuery.data ?? [])
      map.set(user.id, user.name || user.username);
    return map;
  }, [usersQuery.data]);

  const ownerLabel = useCallback((share: DriveShare): string => {
    if (mode === "sent")
      return share.shareType === "public_link" ? t("share.publicLink") : (userNames.get(share.sharedWithUserId ?? "") ?? share.sharedWithUserId ?? "—");
    if (mode === "links")
      return t("share.publicLink");
    return userNames.get(share.createdBy) ?? share.createdBy;
  }, [mode, t, userNames]);

  const shareMap = useMemo(() => new Map(shares.map(share => [share.id, share])), [shares]);
  const items = useMemo(
    () => shares.map(share => shareToDisplayItem(share, ownerLabel(share))),
    [shares, ownerLabel],
  );

  const getCustomActions = useCallback((item: DisplayItem): FileListAction[] => {
    const share = shareMap.get(item.id);
    if (!share)
      return [];

    if (mode === "received") {
      if (share.file && share.permission !== "view") {
        return [{
          key: "download",
          label: t("share.action.download"),
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
        label: t("share.action.copyLink"),
        icon: <Copy className="mr-2 size-4" />,
        onSelect: () => copy(buildPublicShareUrl(share.token)),
      });
    }
    actions.push({
      key: "revoke",
      label: t("share.action.revoke"),
      icon: <Trash2 className="mr-2 size-4" />,
      variant: "destructive",
      onSelect: () => revoke.mutate(share.id),
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
    onPreview: () => undefined,
    onRename: () => undefined,
    onFavoriteChange: () => undefined,
    getCustomActions,
  };

  return (
    <div className="flex h-full min-h-96 flex-col">
      <DriveFileListSurface
        items={items}
        loading={loading}
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
      />
    </div>
  );
}

// ── Public exports wired by the drive page ──

export function ReceivedSharesList() {
  const query = useReceivedShares();
  return (
    <ShareListSurface
      mode="received"
      shares={query.data ?? []}
      loading={query.isLoading}
      onRefresh={() => void query.refetch()}
    />
  );
}

export function SentSharesList() {
  const query = useSentShares();
  return (
    <ShareListSurface
      mode="sent"
      shares={query.data ?? []}
      loading={query.isLoading}
      onRefresh={() => void query.refetch()}
    />
  );
}

export function PublicLinksList() {
  const query = usePublicLinks();
  return (
    <ShareListSurface
      mode="links"
      shares={query.data ?? []}
      loading={query.isLoading}
      onRefresh={() => void query.refetch()}
    />
  );
}
