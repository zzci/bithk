// Drive share dialog: direct (user-to-user) and public-link sharing for a
// single entry, plus management of the entry's existing shares.
//
// Direct mode picks a visible user + permission and creates a `direct` share.
// Link mode generates a `public_link`, then surfaces the copy-ready URL and
// editable link controls (permission / password / expiry / max downloads)
// wired to `useUpdateShare`. The password is write-only — it is never read
// back from the server, so the UI only ever shows whether one is set.

import type { DriveEntry, DriveShare, SharePermission } from "@/shared/lib/api/drive";
import { Check, Copy, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
  useCreateShare,
  useEntryShares,
  useRevokeShare,
  useUpdateShare,
} from "@/shared/lib/api/drive";

import { buildPublicShareUrl, PermissionBadge, useClipboard, useVisibleUsers } from "./-share-lists";

const PERMISSIONS: readonly SharePermission[] = ["view", "download", "edit"];

interface ShareDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ entry, open, onOpenChange }: ShareDialogProps) {
  const { t } = useTranslation(["drive", "common"]);
  const [mode, setMode] = useState<"direct" | "link">("direct");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("drive:share.title", { name: entry.name })}</DialogTitle>
          <DialogDescription>{t("drive:share.description")}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={value => value && setMode(value as "direct" | "link")}>
          <TabsList>
            <TabsTrigger value="direct">{t("drive:share.tab.direct")}</TabsTrigger>
            <TabsTrigger value="link">{t("drive:share.tab.link")}</TabsTrigger>
          </TabsList>
          <TabsContent value="direct" className="pt-3">
            <DirectShareForm entryId={entry.id} />
          </TabsContent>
          <TabsContent value="link" className="pt-3">
            <PublicLinkForm entryId={entry.id} />
          </TabsContent>
        </Tabs>

        <EntrySharesList entryId={entry.id} />
      </DialogContent>
    </Dialog>
  );
}

// ── Permission select ──

function PermissionSelect({ value, onChange, disabled }: {
  readonly value: SharePermission;
  readonly onChange: (value: SharePermission) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation("drive");
  return (
    <Select value={value} onValueChange={v => v && onChange(v as SharePermission)} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSIONS.map(p => (
          <SelectItem key={p} value={p}>{t(`share.permission.${p}`)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Direct share ──

function DirectShareForm({ entryId }: { readonly entryId: string }) {
  const { t } = useTranslation(["drive", "common"]);
  const usersQuery = useVisibleUsers();
  const createShare = useCreateShare();
  const [userId, setUserId] = useState<string | null>(null);
  const [permission, setPermission] = useState<SharePermission>("view");

  const users = usersQuery.data ?? [];

  const submit = () => {
    if (!userId)
      return;
    createShare.mutate(
      { entryId, shareType: "direct", sharedWithUserId: userId, permission },
      { onSuccess: () => setUserId(null) },
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="share-direct-user">{t("drive:share.field.user")}</Label>
        <Select value={userId ?? ""} onValueChange={v => setUserId(v || null)}>
          <SelectTrigger id="share-direct-user" className="w-full">
            <SelectValue placeholder={t("drive:share.userPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {users.map(u => (
              <SelectItem key={u.id} value={u.id}>{`${u.name} (${u.username})`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="share-direct-permission">{t("drive:share.field.permission")}</Label>
        <PermissionSelect value={permission} onChange={setPermission} />
      </div>
      {createShare.error && <p className="text-sm text-destructive">{createShare.error.message}</p>}
      <Button type="button" className="justify-self-end" disabled={!userId || createShare.isPending} onClick={submit}>
        {createShare.isPending ? t("common:common.submitting") : t("drive:share.action.share")}
      </Button>
    </div>
  );
}

// ── Public link ──

/** ISO string → `datetime-local` input value (local time, no seconds). */
function toDatetimeLocal(iso: string | null): string {
  if (!iso)
    return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function PublicLinkForm({ entryId }: { readonly entryId: string }) {
  const { t } = useTranslation(["drive", "common"]);
  const createShare = useCreateShare();
  const [created, setCreated] = useState<DriveShare | null>(null);

  const [permission, setPermission] = useState<SharePermission>("view");
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");

  const generate = () => {
    createShare.mutate(
      {
        entryId,
        shareType: "public_link",
        permission,
        ...(password ? { password } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(maxDownloads ? { maxDownloads: Number(maxDownloads) } : {}),
      },
      { onSuccess: setCreated },
    );
  };

  if (created) {
    return <PublicLinkEditor share={created} onChange={setCreated} />;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="share-link-permission">{t("drive:share.field.permission")}</Label>
        <PermissionSelect value={permission} onChange={setPermission} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="share-link-password">{t("drive:share.field.password")}</Label>
        <Input
          id="share-link-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.currentTarget.value)}
          placeholder={t("drive:share.passwordPlaceholder")}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="share-link-expiry">{t("drive:share.field.expiry")}</Label>
          <Input id="share-link-expiry" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.currentTarget.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="share-link-max">{t("drive:share.field.maxDownloads")}</Label>
          <Input id="share-link-max" type="number" min={1} value={maxDownloads} onChange={e => setMaxDownloads(e.currentTarget.value)} placeholder={t("drive:share.unlimited")} />
        </div>
      </div>
      {createShare.error && <p className="text-sm text-destructive">{createShare.error.message}</p>}
      <Button type="button" className="justify-self-end" disabled={createShare.isPending} onClick={generate}>
        {createShare.isPending ? t("common:common.submitting") : t("drive:share.action.generate")}
      </Button>
    </div>
  );
}

function PublicLinkEditor({ share, onChange }: {
  readonly share: DriveShare;
  readonly onChange: (share: DriveShare) => void;
}) {
  const { t } = useTranslation(["drive", "common"]);
  const updateShare = useUpdateShare();
  const { copied, copy } = useClipboard();
  const url = useMemo(() => buildPublicShareUrl(share.token), [share.token]);

  const [permission, setPermission] = useState<SharePermission>(share.permission);
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => toDatetimeLocal(share.expiresAt));
  const [maxDownloads, setMaxDownloads] = useState(share.maxDownloads !== null ? String(share.maxDownloads) : "");

  const apply = () => {
    updateShare.mutate(
      {
        id: share.id,
        permission,
        ...(password ? { password } : {}),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        maxDownloads: maxDownloads ? Number(maxDownloads) : null,
      },
      {
        onSuccess: (next) => {
          setPassword("");
          onChange(next);
        },
      },
    );
  };

  const clearPassword = () => {
    updateShare.mutate({ id: share.id, password: null }, { onSuccess: onChange });
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="share-link-url">{t("drive:share.linkReady")}</Label>
        <div className="flex items-center gap-2">
          <Input id="share-link-url" readOnly value={url} className="font-mono text-xs" onFocus={e => e.currentTarget.select()} />
          <Button type="button" variant="outline" size="icon" title={t("drive:share.action.copyLink")} onClick={() => copy(url)}>
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="share-link-permission-edit">{t("drive:share.field.permission")}</Label>
        <PermissionSelect value={permission} onChange={setPermission} disabled={updateShare.isPending} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="share-link-password-edit">{t("drive:share.field.password")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="share-link-password-edit"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
            placeholder={share.hasPassword ? t("drive:share.passwordKeep") : t("drive:share.passwordPlaceholder")}
          />
          {share.hasPassword && (
            <Button type="button" variant="ghost" size="sm" disabled={updateShare.isPending} onClick={clearPassword}>
              {t("drive:share.action.removePassword")}
            </Button>
          )}
        </div>
        {share.hasPassword && <Badge variant="secondary" className="w-fit">{t("drive:share.passwordSet")}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="share-link-expiry-edit">{t("drive:share.field.expiry")}</Label>
          <Input id="share-link-expiry-edit" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.currentTarget.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="share-link-max-edit">{t("drive:share.field.maxDownloads")}</Label>
          <Input id="share-link-max-edit" type="number" min={1} value={maxDownloads} onChange={e => setMaxDownloads(e.currentTarget.value)} placeholder={t("drive:share.unlimited")} />
        </div>
      </div>

      {updateShare.error && <p className="text-sm text-destructive">{updateShare.error.message}</p>}
      <Button type="button" className="justify-self-end" disabled={updateShare.isPending} onClick={apply}>
        {updateShare.isPending ? t("common:common.saving") : t("drive:share.action.updateLink")}
      </Button>
    </div>
  );
}

// ── Existing shares for the entry ──

function EntrySharesList({ entryId }: { readonly entryId: string }) {
  const { t } = useTranslation(["drive", "common"]);
  const query = useEntryShares(entryId);
  const revoke = useRevokeShare();
  const shares = query.data ?? [];

  if (query.isLoading)
    return <p className="border-t pt-3 text-sm text-muted-foreground">{t("common:common.loading")}</p>;
  if (query.error)
    return <p className="border-t pt-3 text-sm text-destructive">{query.error.message}</p>;
  if (shares.length === 0)
    return <p className="border-t pt-3 text-sm text-muted-foreground">{t("drive:share.empty.entry")}</p>;

  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="text-sm font-medium">{t("drive:share.existing")}</p>
      <ul className="grid gap-1">
        {shares.map(share => (
          <li key={share.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
            <Badge variant="outline">{t(`drive:share.type.${share.shareType}`)}</Badge>
            <PermissionBadge permission={share.permission} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {share.shareType === "direct" ? share.sharedWithUserId : t("drive:share.publicAnyone")}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" title={t("drive:share.action.revoke")} disabled={revoke.isPending} onClick={() => revoke.mutate(share.id)}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
