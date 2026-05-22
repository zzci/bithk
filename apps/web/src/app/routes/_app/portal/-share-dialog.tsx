// Drive share dialog: a Google-Drive-style sharing surface for a single
// entry. Two sections compose it:
//
//   "People with access" — the owner, every existing direct share, and an
//   inline "add people" popover that multi-selects visible users at a chosen
//   permission. Pending picks are previewed in the list until the dialog is
//   committed.
//
//   "General access" — toggles the entry between restricted (direct shares
//   only) and a public link "anyone with the link". The link options popover
//   edits the public link's expiry and password.
//
// Committing ("Done") reconciles the desired state against the server: it
// creates the pending direct shares, creates the public link when access was
// switched to "anyone", and revokes the public link when switched back to
// "restricted". The password is write-only — never read back, so the UI only
// ever reflects whether one is set.

import type { DriveEntry, DriveShare, SharePermission } from "@/shared/lib/api/drive";
import { Check, Copy, Globe2, KeyRound, Loader2, LockKeyhole, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Separator } from "@/shared/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/components/ui/tooltip";
import {
  useCreateShare,
  useEntryShares,
  useRevokeShare,
  useUpdateShare,
} from "@/shared/lib/api/drive";
import { useAuthStore } from "@/shared/stores/auth";

import { buildPublicShareUrl, useClipboard, useVisibleUsers } from "./-share-lists";

type DirectPermission = "view" | "edit";
type AccessMode = "restricted" | "anyone";

interface ShareDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface PickableUser {
  readonly id: string;
  readonly name: string;
  readonly username: string;
}

function userLabel(user: PickableUser): string {
  return user.name || user.username || user.id;
}

function initials(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "?";
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

/** Absolute expiry → the closest select bucket the UI offers. */
function expirationValueFrom(expiresAt: string | null | undefined): string {
  if (!expiresAt)
    return "never";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0)
    return "never";
  const days = Math.ceil(diff / 86_400_000);
  if (days <= 1)
    return "1";
  if (days <= 7)
    return "7";
  return "30";
}

export function ShareDialog({ entry, open, onOpenChange }: ShareDialogProps) {
  const { t } = useTranslation(["drive", "common"]);
  const currentUser = useAuthStore(s => s.user);
  const sharesQuery = useEntryShares(open ? entry.id : undefined);
  const usersQuery = useVisibleUsers();
  const createShare = useCreateShare();
  const updateShare = useUpdateShare();
  const revokeShare = useRevokeShare();
  const { copied, copy } = useClipboard(2000);

  const shares = useMemo(() => sharesQuery.data ?? [], [sharesQuery.data]);
  const users = usersQuery.data ?? [];

  const [recipientQuery, setRecipientQuery] = useState("");
  const [pendingUserIds, setPendingUserIds] = useState<string[]>([]);
  const [directPermission, setDirectPermission] = useState<DirectPermission>("edit");
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [accessMode, setAccessMode] = useState<AccessMode>("restricted");
  const [publicSettingsOpen, setPublicSettingsOpen] = useState(false);
  const [publicExpiresIn, setPublicExpiresIn] = useState("never");
  const [publicPassword, setPublicPassword] = useState("");
  const [savingChanges, setSavingChanges] = useState(false);
  const [savingPublicSettings, setSavingPublicSettings] = useState(false);

  const publicShare = shares.find(share => share.shareType === "public_link");
  const directShares = shares.filter(share => share.shareType === "direct");
  const shareLink = publicShare ? buildPublicShareUrl(publicShare.token) : null;
  const isPublicAccess = accessMode === "anyone";

  // Re-sync the desired-state controls whenever the dialog opens or the
  // server view changes (after a create/revoke), mirroring the original
  // load-then-reset behaviour.
  useEffect(() => {
    if (!open)
      return;
    const nextPublicShare = shares.find(share => share.shareType === "public_link");
    setAccessMode(nextPublicShare ? "anyone" : "restricted");
    setPublicExpiresIn(expirationValueFrom(nextPublicShare?.expiresAt));
    setPublicPassword("");
  }, [open, shares]);

  const sharedUserIds = useMemo(
    () => new Set(directShares.map(share => share.sharedWithUserId).filter((id): id is string => Boolean(id))),
    [directShares],
  );
  const availableUsers = users.filter(user => user.id !== currentUser?.id && !sharedUserIds.has(user.id));
  const pendingUsers = users.filter(user => pendingUserIds.includes(user.id));
  const filteredUsers = availableUsers.filter((user) => {
    if (!addPeopleOpen)
      return false;
    const query = recipientQuery.trim().toLowerCase();
    if (!query)
      return true;
    return userLabel(user).toLowerCase().includes(query) || user.username.toLowerCase().includes(query);
  });

  const resetState = () => {
    setRecipientQuery("");
    setPendingUserIds([]);
    setDirectPermission("edit");
    setAddPeopleOpen(false);
    setPublicSettingsOpen(false);
    setPublicPassword("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen)
      resetState();
    onOpenChange(nextOpen);
  };

  const togglePendingUser = (userId: string) => {
    setPendingUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const closeAddPeople = () => {
    setAddPeopleOpen(false);
    setRecipientQuery("");
    setPendingUserIds([]);
    setDirectPermission("edit");
  };

  const toggleAddPeople = () => {
    if (addPeopleOpen) {
      closeAddPeople();
      return;
    }
    setPublicSettingsOpen(false);
    setAddPeopleOpen(true);
  };

  const closePublicSettings = () => {
    setPublicSettingsOpen(false);
    setPublicExpiresIn(expirationValueFrom(publicShare?.expiresAt));
    setPublicPassword("");
  };

  const togglePublicSettings = () => {
    if (publicSettingsOpen) {
      closePublicSettings();
      return;
    }
    setPublicExpiresIn(expirationValueFrom(publicShare?.expiresAt));
    setPublicPassword("");
    setPublicSettingsOpen(true);
    setAddPeopleOpen(false);
  };

  const handleCopyLink = () => {
    if (shareLink && isPublicAccess)
      copy(shareLink);
  };

  const updatePublicLinkSettings = async (removePassword = false) => {
    if (!publicShare) {
      setPublicSettingsOpen(false);
      return;
    }
    setSavingPublicSettings(true);
    try {
      await updateShare.mutateAsync({
        id: publicShare.id,
        expiresAt: expiresAtFromValue(publicExpiresIn),
        ...(removePassword ? { password: null } : (publicPassword.trim() ? { password: publicPassword.trim() } : {})),
      });
      setPublicPassword("");
      setPublicSettingsOpen(false);
    }
    catch {
      // The failure surfaces through `updateShare.error`; keep the popover
      // open so the user can retry rather than crashing the promise chain.
    }
    finally {
      setSavingPublicSettings(false);
    }
  };

  const handleDone = async () => {
    setSavingChanges(true);
    try {
      for (const userId of pendingUserIds) {
        await createShare.mutateAsync({
          entryId: entry.id,
          shareType: "direct",
          sharedWithUserId: userId,
          permission: directPermission,
        });
      }
      if (accessMode === "anyone" && !publicShare) {
        const expiresAt = expiresAtFromValue(publicExpiresIn);
        await createShare.mutateAsync({
          entryId: entry.id,
          shareType: "public_link",
          permission: "view",
          ...(expiresAt ? { expiresAt } : {}),
          ...(publicPassword.trim() ? { password: publicPassword.trim() } : {}),
        });
      }
      if (accessMode === "restricted" && publicShare)
        await revokeShare.mutateAsync(publicShare.id);
      handleOpenChange(false);
    }
    catch {
      // A failed create/revoke surfaces through the mutation's error state;
      // leave the dialog open (and the rejection handled) so nothing is lost.
    }
    finally {
      setSavingChanges(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[600px] gap-0 overflow-visible p-0">
        <DialogHeader className="w-full min-w-0 px-6 pt-5 pb-3">
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-10 text-xl font-medium">
            <Share2 className="size-5 shrink-0" />
            <span className="truncate">{t("drive:share.heading")}</span>
          </DialogTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Input
                    value={entry.name}
                    readOnly
                    tabIndex={-1}
                    className="h-8 w-full cursor-default rounded-none border-0 border-b border-input bg-transparent px-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
                  />
                )}
              />
              <TooltipContent side="bottom" align="start" className="max-w-[520px] break-all">
                {entry.name}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DialogHeader>

        <div className="flex min-h-[220px] flex-col gap-4 px-6 pb-5">
          <section className="relative flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-medium">{t("drive:share.peopleWithAccess")}</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full px-4"
                aria-label={t("drive:share.addPeoplePlaceholder")}
                aria-expanded={addPeopleOpen}
                onClick={toggleAddPeople}
              >
                {t("common:common.add")}
              </Button>
            </div>

            {addPeopleOpen && (
              <div className="absolute top-9 right-0 z-20 w-[420px] max-w-[calc(100vw-3rem)] rounded-xl border bg-popover p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{t("drive:share.addPeoplePlaceholder")}</p>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:common.close")} onClick={closeAddPeople}>
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="relative">
                    <Input
                      value={recipientQuery}
                      onChange={event => setRecipientQuery(event.currentTarget.value)}
                      placeholder={t("drive:share.addPeoplePlaceholder")}
                      className="h-10"
                    />
                    {filteredUsers.length > 0 && (
                      <div className="absolute top-12 right-0 left-0 z-50 max-h-56 overflow-auto rounded-md border bg-popover p-1 shadow-md">
                        {filteredUsers.map(user => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => togglePendingUser(user.id)}
                            className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-accent"
                          >
                            <Avatar>
                              <AvatarFallback>{initials(userLabel(user))}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{userLabel(user)}</span>
                              <span className="block truncate text-xs text-muted-foreground">{user.username}</span>
                            </span>
                            {pendingUserIds.includes(user.id) && <Check className="size-4 text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {pendingUsers.length > 0 && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {pendingUsers.map(user => (
                          <span key={user.id} className="inline-flex max-w-[220px] items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm">
                            <span className="truncate">{userLabel(user)}</span>
                            <button type="button" aria-label={t("drive:share.action.remove")} onClick={() => togglePendingUser(user.id)}>
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <Select value={directPermission} onValueChange={value => value && setDirectPermission(value as DirectPermission)}>
                        <SelectTrigger className="w-[120px] shrink-0">
                          <SelectValue>
                            {(v: string) => t(`drive:share.permission.${v}`)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">{t("drive:share.permission.view")}</SelectItem>
                          <SelectItem value="edit">{t("drive:share.permission.edit")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={closeAddPeople}>
                      {t("common:common.cancel")}
                    </Button>
                    <Button type="button" disabled={pendingUserIds.length === 0} onClick={() => setAddPeopleOpen(false)}>
                      {t("common:common.add")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {currentUser && (
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{initials(currentUser.name || currentUser.username)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {currentUser.name || currentUser.username}
                    {" "}
                    {t("drive:share.youSuffix")}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{currentUser.email}</p>
                </div>
                <span className="text-sm text-muted-foreground">{t("drive:share.owner")}</span>
              </div>
            )}

            {directShares.map(share => (
              <DirectShareRow
                key={share.id}
                share={share}
                label={resolveShareLabel(share, users)}
                onPermissionChange={permission => updateShare.mutate({ id: share.id, permission })}
                onRemove={() => revokeShare.mutate(share.id)}
                disabled={savingChanges}
              />
            ))}

            {pendingUsers.map(user => (
              <div key={user.id} className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{initials(userLabel(user))}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{userLabel(user)}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {directPermission === "edit" ? t("drive:share.permission.edit") : t("drive:share.permission.view")}
                  </p>
                </div>
                <Select value={directPermission} onValueChange={value => value && setDirectPermission(value as DirectPermission)}>
                  <SelectTrigger className="w-[120px] border-0 shadow-none">
                    <SelectValue>
                      {(v: string) => t(`drive:share.permission.${v}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">{t("drive:share.permission.view")}</SelectItem>
                    <SelectItem value="edit">{t("drive:share.permission.edit")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </section>

          <section className="relative flex flex-col gap-2">
            <h3 className="text-base font-medium">{t("drive:share.generalAccess")}</h3>
            <div className="flex min-h-[58px] items-start gap-3">
              <Avatar>
                <AvatarFallback className={isPublicAccess ? "bg-primary/10 text-primary" : undefined}>
                  {isPublicAccess ? <Globe2 className="size-5" /> : <LockKeyhole className="size-5" />}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Select
                    value={accessMode}
                    onValueChange={value => value && setAccessMode(value as AccessMode)}
                    disabled={savingChanges}
                  >
                    <SelectTrigger className="h-8 w-[220px] border-0 px-0 shadow-none">
                      <SelectValue>
                        {(v: string) => t(v === "anyone" ? "drive:share.linkAnyone" : "drive:share.linkRestricted")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restricted">{t("drive:share.linkRestricted")}</SelectItem>
                      <SelectItem value="anyone">{t("drive:share.linkAnyone")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex w-[120px] justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={isPublicAccess ? "rounded-full px-4" : "invisible rounded-full px-4"}
                      aria-expanded={publicSettingsOpen}
                      disabled={!isPublicAccess || savingChanges}
                      onClick={togglePublicSettings}
                    >
                      {t("drive:share.publicLinkOptions")}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {isPublicAccess ? t("drive:share.publicLinkReadOnlyDesc") : t("drive:share.linkRestrictedDesc")}
                </p>
              </div>
            </div>

            {isPublicAccess && publicSettingsOpen && (
              <div className="absolute top-[76px] right-0 z-20 w-[360px] max-w-[calc(100vw-3rem)] rounded-xl border bg-popover p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{t("drive:share.publicLinkOptions")}</p>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:common.close")} onClick={closePublicSettings}>
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    {t("drive:share.expiration")}
                    <Select value={publicExpiresIn} onValueChange={value => value && setPublicExpiresIn(value)}>
                      <SelectTrigger>
                        <SelectValue>
                          {(v: string) => t(v === "never"
                            ? "drive:share.expiresNever"
                            : v === "1"
                              ? "drive:share.expires1Day"
                              : v === "7" ? "drive:share.expires7Days" : "drive:share.expires30Days")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">{t("drive:share.expiresNever")}</SelectItem>
                        <SelectItem value="1">{t("drive:share.expires1Day")}</SelectItem>
                        <SelectItem value="7">{t("drive:share.expires7Days")}</SelectItem>
                        <SelectItem value="30">{t("drive:share.expires30Days")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    {t("drive:share.field.password")}
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={publicPassword}
                        onChange={event => setPublicPassword(event.currentTarget.value)}
                        placeholder={publicShare?.hasPassword ? t("drive:share.passwordKeep") : t("drive:share.passwordPlaceholder")}
                        className="pl-9"
                      />
                    </div>
                  </label>
                </div>
                <div className="mt-4 flex min-h-9 items-center justify-between gap-2">
                  <div className="w-[112px]">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={publicShare?.hasPassword ? "" : "invisible"}
                      disabled={!publicShare?.hasPassword || savingPublicSettings}
                      onClick={() => void updatePublicLinkSettings(true)}
                    >
                      {t("drive:share.action.removePassword")}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" disabled={savingPublicSettings} onClick={closePublicSettings}>
                      {t("common:common.close")}
                    </Button>
                    <Button type="button" size="sm" disabled={savingPublicSettings || !publicShare} onClick={() => void updatePublicLinkSettings()}>
                      {savingPublicSettings && <Loader2 className="size-4 animate-spin" />}
                      {t("drive:share.action.update")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <Separator />

        <div className="flex items-center justify-between px-6 py-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={savingChanges || !isPublicAccess || !shareLink}
            onClick={handleCopyLink}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {t("drive:share.action.copyLink")}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="rounded-full px-6" disabled={savingChanges} onClick={() => handleOpenChange(false)}>
              {t("common:common.close")}
            </Button>
            <Button type="button" className="rounded-full px-8" disabled={savingChanges} onClick={() => void handleDone()}>
              {savingChanges && <Loader2 className="size-4 animate-spin" />}
              {t("drive:share.action.done")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Resolve the display label for a direct share's recipient. */
function resolveShareLabel(share: DriveShare, users: readonly PickableUser[]): string {
  const match = users.find(user => user.id === share.sharedWithUserId);
  if (match)
    return userLabel(match);
  return share.sharedWithUserId ?? "—";
}

function DirectShareRow({
  share,
  label,
  onPermissionChange,
  onRemove,
  disabled,
}: {
  readonly share: DriveShare;
  readonly label: string;
  readonly onPermissionChange: (permission: SharePermission) => void;
  readonly onRemove: () => void;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation(["drive", "common"]);
  const value: DirectPermission = share.permission === "edit" ? "edit" : "view";
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>{initials(label)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-sm text-muted-foreground">
          {value === "edit" ? t("drive:share.permission.edit") : t("drive:share.permission.view")}
        </p>
      </div>
      <Select value={value} onValueChange={next => next && onPermissionChange(next as SharePermission)} disabled={disabled}>
        <SelectTrigger className="w-[120px] border-0 shadow-none">
          <SelectValue>
            {(v: string) => t(`drive:share.permission.${v}`)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">{t("drive:share.permission.view")}</SelectItem>
          <SelectItem value="edit">{t("drive:share.permission.edit")}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("drive:share.action.revoke")} disabled={disabled} onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
