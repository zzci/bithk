/* eslint-disable react-refresh/only-export-components */
// Drive share lists + shared share-UI helpers.
//
// Exposes the three "share inbox/outbox" lists wired by the drive page
// (Shared with me / Shared by me / Public links) plus small primitives
// reused by `-share-dialog.tsx`: the public-link URL builder, a clipboard
// hook, a permission badge, the visible-users picker source, and the byte/
// date formatters. Keeping these here avoids duplicating share concerns
// across the dialog and the lists.

import type { SimpleUser } from "@/shared/lib/api/documents";
import type { DriveShare, SharePermission } from "@/shared/lib/api/drive";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Link2, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/components/ui/tooltip";
import {
  downloadDriveEntry,
  usePublicLinks,
  useReceivedShares,
  useRevokeShare,
  useSentShares,
} from "@/shared/lib/api/drive";
import { http } from "@/shared/lib/http";

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

export function PermissionBadge({ permission }: { readonly permission: SharePermission }) {
  const { t } = useTranslation("drive");
  return <Badge variant="secondary">{t(`share.permission.${permission}`)}</Badge>;
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

// ── Shared list scaffolding ──

function ListState({ loading, error, empty, emptyLabel, cols }: {
  readonly loading: boolean;
  readonly error: Error | null;
  readonly empty: boolean;
  readonly emptyLabel: string;
  readonly cols: number;
}) {
  const { t } = useTranslation(["drive", "common"]);
  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={cols} className="h-20 text-center text-muted-foreground">{t("common:common.loading")}</TableCell>
      </TableRow>
    );
  }
  if (error) {
    return (
      <TableRow>
        <TableCell colSpan={cols} className="h-20 text-center text-destructive">{error.message}</TableCell>
      </TableRow>
    );
  }
  if (empty) {
    return (
      <TableRow>
        <TableCell colSpan={cols} className="h-20 text-center text-muted-foreground">{emptyLabel}</TableCell>
      </TableRow>
    );
  }
  return null;
}

// ── Received: "Shared with me" ──

export function ReceivedSharesList() {
  const { t } = useTranslation("drive");
  const query = useReceivedShares();
  const shares = query.data ?? [];

  const download = (share: DriveShare) => {
    // The content endpoint authorizes the recipient through the share grant;
    // build the minimal entry view the downloader needs.
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
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("share.col.name")}</TableHead>
          <TableHead className="hidden w-28 md:table-cell">{t("share.col.size")}</TableHead>
          <TableHead className="w-28">{t("share.col.permission")}</TableHead>
          <TableHead className="w-12 text-right">{t("share.col.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <ListState loading={query.isLoading} error={query.error} empty={shares.length === 0} emptyLabel={t("share.empty.received")} cols={4} />
        {shares.map(share => (
          <TableRow key={share.id}>
            <TableCell className="min-w-0 truncate">{share.entryName}</TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">{share.file ? formatBytes(share.file.size) : "-"}</TableCell>
            <TableCell><PermissionBadge permission={share.permission} /></TableCell>
            <TableCell className="text-right">
              {share.permission !== "view" && share.file && (
                <Button type="button" variant="ghost" size="icon-sm" title={t("share.action.download")} onClick={() => download(share)}>
                  <Download className="size-4" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Sent: "Shared by me" ──

export function SentSharesList() {
  const { t } = useTranslation("drive");
  const query = useSentShares();
  const revoke = useRevokeShare();
  const shares = query.data ?? [];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("share.col.name")}</TableHead>
          <TableHead className="hidden w-28 md:table-cell">{t("share.col.type")}</TableHead>
          <TableHead className="w-28">{t("share.col.permission")}</TableHead>
          <TableHead className="w-12 text-right">{t("share.col.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <ListState loading={query.isLoading} error={query.error} empty={shares.length === 0} emptyLabel={t("share.empty.sent")} cols={4} />
        {shares.map(share => (
          <TableRow key={share.id}>
            <TableCell className="min-w-0 truncate">{share.entryName}</TableCell>
            <TableCell className="hidden md:table-cell">
              <Badge variant="outline">{t(`share.type.${share.shareType}`)}</Badge>
            </TableCell>
            <TableCell><PermissionBadge permission={share.permission} /></TableCell>
            <TableCell className="text-right">
              <Button type="button" variant="ghost" size="icon-sm" title={t("share.action.revoke")} disabled={revoke.isPending} onClick={() => revoke.mutate(share.id)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Public links ──

export function PublicLinksList() {
  const { t } = useTranslation("drive");
  const query = usePublicLinks();
  const revoke = useRevokeShare();
  const { copied, copy } = useClipboard();
  const links = query.data ?? [];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("share.col.name")}</TableHead>
          <TableHead className="w-28">{t("share.col.permission")}</TableHead>
          <TableHead className="hidden w-28 md:table-cell">{t("share.col.downloads")}</TableHead>
          <TableHead className="hidden w-44 lg:table-cell">{t("share.col.expires")}</TableHead>
          <TableHead className="w-24 text-right">{t("share.col.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <ListState loading={query.isLoading} error={query.error} empty={links.length === 0} emptyLabel={t("share.empty.links")} cols={5} />
        {links.map(link => (
          <TableRow key={link.id}>
            <TableCell className="min-w-0 truncate">
              <span className="flex min-w-0 items-center gap-2">
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{link.entryName}</span>
              </span>
            </TableCell>
            <TableCell><PermissionBadge permission={link.permission} /></TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {link.downloadCount}
              {link.maxDownloads !== null ? ` / ${link.maxDownloads}` : ""}
            </TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell">
              {link.expiresAt ? formatDate(link.expiresAt) : t("share.noExpiry")}
            </TableCell>
            <TableCell className="text-right">
              <span className="inline-flex items-center justify-end gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={t("share.action.copyLink")}
                          onClick={() => copy(buildPublicShareUrl(link.token))}
                        />
                      )}
                    >
                      <Copy className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>{copied ? t("share.copied") : t("share.action.copyLink")}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button type="button" variant="ghost" size="icon-sm" title={t("share.action.revoke")} disabled={revoke.isPending} onClick={() => revoke.mutate(link.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
