// Documents-only share dialog. The comment/attachment sections that
// used to live here moved to the generic shared/components/resource
// implementations; both modules (documents + issues) now consume them.

import type {
  Document,
  DocumentPublicLink,
  DocumentShare,
  SimpleGroup,
  SimpleUser,
} from "@/shared/lib/api/documents";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, KeyRound, Loader2, Lock, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
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
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  documentsKeys,
  useCreateDocumentPublicLink,
  useDocumentPublicLinks,
  useRevokeDocumentPublicLink,
} from "@/shared/lib/api/documents";
import { errorMessage } from "@/shared/lib/errors";
import { http } from "@/shared/lib/http";
import { displayName } from "@/shared/lib/users";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";

export function ShareDialog({
  doc,
  users,
  groups,
  userMap,
  onClose,
}: {
  readonly doc: Document;
  readonly users: readonly SimpleUser[];
  readonly groups: readonly SimpleGroup[];
  readonly userMap: Map<string, SimpleUser>;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation("documents");
  const qc = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  // Public-link management is owner-only (the backend asserts
  // `document:manage`, which is the creator). Hide the whole section for
  // non-owners rather than surfacing a section whose queries 403.
  const isOwner = doc.creatorId === currentUser?.id;
  const [targetType, setTargetType] = useState<"user" | "group">("user");
  const [targetId, setTargetId] = useState("");
  const [permission, setPermission] = useState<"viewer" | "editor">("viewer");
  const [error, setError] = useState<string | null>(null);

  const sharesQuery = useQuery({
    queryKey: documentsKeys.shares(doc.id),
    queryFn: () => http<{ data: DocumentShare[] }>(`/documents/${doc.id}/shares`).then(r => r.data),
  });

  const addShare = useMutation({
    mutationFn: async () => {
      await http(`/documents/${doc.id}/shares`, {
        method: "POST",
        body: JSON.stringify({ targetType, targetId, permission }),
      });
    },
    onSuccess: () => {
      setTargetId("");
      void qc.invalidateQueries({ queryKey: documentsKeys.shares(doc.id) });
    },
    onError: err => setError(errorMessage(err, t("common.error.operationFailed"))),
  });

  const removeShare = useMutation({
    mutationFn: async (shareId: string) => {
      await http(`/documents/${doc.id}/shares/${shareId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentsKeys.shares(doc.id) });
    },
    onError: err => setError(errorMessage(err, t("common.error.deleteFailed"))),
  });

  const groupMap = new Map(groups.map(g => [g.id, g]));
  const shares = sharesQuery.data ?? [];
  const targetName = (share: DocumentShare) => {
    if (share.targetType === "user")
      return displayName(userMap, share.targetId);
    return displayName(groupMap, share.targetId);
  };

  // Filter out targets that already have a *direct* (non-inherited) grant
  // on this doc. Targets that hold only an inherited grant remain
  // selectable so the user can escalate (e.g. inherited viewer → editor).
  const availableTargets = targetType === "user"
    ? users.filter(u => u.id !== doc.creatorId && !shares.some(s => s.targetType === "user" && s.targetId === u.id && s.inheritedFrom === null))
    : groups.filter(g => !shares.some(s => s.targetType === "group" && s.targetId === g.id && s.inheritedFrom === null));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shareTitle")}</DialogTitle>
          <DialogDescription>{t("shareDescription")}</DialogDescription>
        </DialogHeader>

        <ErrorBanner message={error} />

        <div className="space-y-3">
          <div className="flex gap-2">
            <Select
              value={targetType}
              onValueChange={(v) => {
                setTargetType(v as "user" | "group");
                setTargetId("");
              }}
            >
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t("targetUser")}</SelectItem>
                <SelectItem value="group">{t("targetGroup")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={targetId || "__none__"} onValueChange={v => setTargetId(!v || v === "__none__" ? "" : v)}>
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue>
                  {(v: string) => {
                    if (v === "__none__")
                      return targetType === "user" ? t("targetUser") : t("targetGroup");
                    if (targetType === "user")
                      return displayName(userMap, v);
                    return displayName(groupMap, v);
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>--</SelectItem>
                {availableTargets.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Select value={permission} onValueChange={v => setPermission(v as "viewer" | "editor")}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">{t("viewer")}</SelectItem>
                <SelectItem value="editor">{t("editor")}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!targetId || addShare.isPending} onClick={() => addShare.mutate()}>
              {t("addShare")}
            </Button>
          </div>
        </div>

        <div className="min-w-0 space-y-2 mt-2">
          {sharesQuery.isLoading
            ? <div className="text-sm text-muted-foreground text-center py-3">{t("common.loading")}</div>
            : shares.length === 0
              ? <div className="text-sm text-muted-foreground text-center py-3">{t("noShares")}</div>
              : shares.map(share => (
                  <div
                    key={share.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2",
                      share.inheritedFrom && "bg-muted/40",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{targetName(share)}</div>
                      <div className="text-xs text-muted-foreground">
                        {share.targetType === "user" ? t("targetUser") : t("targetGroup")}
                        {" · "}
                        {share.permission === "editor" ? t("editor") : t("viewer")}
                        {share.inheritedFrom && (
                          <>
                            {" · "}
                            <span className="italic">{t("inheritedFrom", { title: share.inheritedFrom.title })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {share.inheritedFrom
                      ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled
                            title={t("inheritedNotRemovable")}
                            className="opacity-50 cursor-not-allowed"
                          >
                            <Lock className="size-4 text-muted-foreground" />
                          </Button>
                        )
                      : (
                          <Button variant="ghost" size="icon-sm" onClick={() => removeShare.mutate(share.id)}>
                            <X className="size-4 text-destructive" />
                          </Button>
                        )}
                  </div>
                ))}
        </div>

        {isOwner && <PublicLinkSection docId={doc.id} />}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Absolute, copy-ready URL for a document public-link token. Mirrors the
 * drive scheme (`/drive/shared/:token`) namespaced for documents. No SPA
 * viewer route consumes this yet — the URL is canonical regardless.
 */
function buildDocumentPublicLinkUrl(token: string): string {
  return `${window.location.origin}/documents/shared/${encodeURIComponent(token)}`;
}

/** Public-link expiry select value → absolute ISO timestamp (or null). */
function expiresAtFromValue(value: string): string | null {
  if (value === "never")
    return null;
  const days = Number(value);
  if (!Number.isFinite(days))
    return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/** Clipboard helper with a transient "copied" flag for button feedback. */
function useClipboard(resetMs = 2000): { readonly copied: boolean; readonly copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(setCopied, resetMs, false);
    });
  }, [resetMs]);
  return { copied, copy };
}

/**
 * Owner-only public-link management for a document. Lists active
 * view-only links, creates a new one (optional expiry + password), and
 * revokes existing ones. The password is write-only — the API never
 * returns it, so the UI reflects only whether one is set.
 */
function PublicLinkSection({ docId }: { readonly docId: string }) {
  const { t } = useTranslation("documents");
  const linksQuery = useDocumentPublicLinks(docId);
  const createLink = useCreateDocumentPublicLink();
  const revokeLink = useRevokeDocumentPublicLink();

  const [expiresIn, setExpiresIn] = useState("never");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Revoked links are soft-deleted (isActive=0); list only the live ones.
  const links = (linksQuery.data ?? []).filter(link => link.isActive);

  const handleCreate = () => {
    const expiresAt = expiresAtFromValue(expiresIn);
    createLink.mutate(
      {
        docId,
        ...(expiresAt ? { expiresAt } : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      },
      {
        onSuccess: () => {
          setPassword("");
          setExpiresIn("never");
          setError(null);
        },
        onError: err => setError(errorMessage(err, t("common.error.operationFailed"))),
      },
    );
  };

  const handleRevoke = (linkId: string) => {
    revokeLink.mutate(
      { docId, linkId },
      { onError: err => setError(errorMessage(err, t("common.error.deleteFailed"))) },
    );
  };

  return (
    <div className="min-w-0 space-y-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("publicLink.title")}</div>
          <div className="text-xs text-muted-foreground">{t("publicLink.description")}</div>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* A document has at most one active public link: the create form only
          shows while none exists; otherwise the link itself is rendered. */}
      {!linksQuery.isLoading && links.length === 0 && (
        <div className="flex gap-2">
          <Select value={expiresIn} onValueChange={v => v && setExpiresIn(v)}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue>
                {(v: string) => t(v === "never"
                  ? "publicLink.expiresNever"
                  : v === "1"
                    ? "publicLink.expires1Day"
                    : v === "7" ? "publicLink.expires7Days" : "publicLink.expires30Days")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">{t("publicLink.expiresNever")}</SelectItem>
              <SelectItem value="1">{t("publicLink.expires1Day")}</SelectItem>
              <SelectItem value="7">{t("publicLink.expires7Days")}</SelectItem>
              <SelectItem value="30">{t("publicLink.expires30Days")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
            placeholder={t("publicLink.passwordPlaceholder")}
            className="h-8 flex-1"
          />
          <Button size="sm" disabled={createLink.isPending} onClick={handleCreate}>
            {createLink.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("publicLink.create")}
          </Button>
        </div>
      )}

      {links.length > 0 && (
        <div className="space-y-2">
          {links.map(link => (
            <PublicLinkRow
              key={link.id}
              link={link}
              onRevoke={() => handleRevoke(link.id)}
              disabled={revokeLink.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PublicLinkRow({
  link,
  onRevoke,
  disabled,
}: {
  readonly link: DocumentPublicLink;
  readonly onRevoke: () => void;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation("documents");
  const { copied, copy } = useClipboard();
  const url = buildDocumentPublicLinkUrl(link.token);
  return (
    <div className="space-y-2 rounded-md border px-3 py-2">
      {/* Full URL in a scrollable monospace block — no truncation; the row
          scrolls horizontally so the whole link stays readable. */}
      <code className="block overflow-x-auto whitespace-nowrap rounded bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
        {url}
      </code>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{t("publicLink.viewOnly")}</span>
          {link.hasPassword && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="inline-flex items-center gap-1">
                <KeyRound className="size-3" />
                {t("publicLink.hasPassword")}
              </span>
            </>
          )}
          <span className="text-muted-foreground/50">·</span>
          <span>{link.expiresAt ? t("publicLink.expiresOn", { date: formatExpiry(link.expiresAt) }) : t("publicLink.neverExpires")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title={copied ? t("publicLink.copied") : t("publicLink.copy")}
            aria-label={t("publicLink.copy")}
            onClick={() => copy(url)}
          >
            {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("publicLink.revoke")}
            aria-label={t("publicLink.revoke")}
            disabled={disabled}
            onClick={onRevoke}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}
