// Unified, resource-agnostic share dialog. Capabilities from
// `useShareCapabilities` drive which controls render:
//   - "direct" → the "People with access" section (multi-select users at a
//     chosen permission), previewed until "Done" commits.
//   - "public_link" → the "General access" section toggling between
//     restricted and an "anyone with the link" public link.
// Resources that only advertise a view-only public link (documents) get just
// the general-access section; their collaborator grants are injected through
// the registry's `renderExtraSection` slot, which keeps its own API.
//
// Committing ("Done") reconciles the desired state against the server: it
// creates the pending direct shares, creates the public link when access was
// switched to "anyone", and revokes it when switched back. The password is
// write-only — never read back, so the UI only reflects whether one is set.

import type { ReactNode } from "react";
import type { ShareTarget } from "./use-share";
import type { ShareCapabilities, SharePermission, ShareView } from "@/shared/lib/api/share";
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
  buildShareUrl,
  useCreateShare,
  useRevokeShare,
  useUpdateShare,
} from "@/shared/lib/api/share";
import { useAuthStore } from "@/shared/stores/auth";

import { expirationValueFrom, expiresAtFromValue, useClipboard, useVisibleUsers } from "./share-helpers";

type DirectPermission = "view" | "edit";
type AccessMode = "restricted" | "anyone";

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

interface ShareDialogProps {
  readonly target: ShareTarget;
  readonly capabilities: ShareCapabilities;
  readonly shares: readonly ShareView[];
  readonly sharesLoading: boolean;
  readonly extraSection: ReactNode;
  readonly onClose: () => void;
}

/**
 * The dialog body. Mounted only with loaded capabilities + shares so the
 * desired-state controls seed from the real server view on first render.
 */
export function ShareDialog({ target, capabilities, shares, sharesLoading, extraSection, onClose }: ShareDialogProps) {
  const { t } = useTranslation(["share", "common"]);
  const currentUser = useAuthStore(s => s.user);
  const usersQuery = useVisibleUsers();
  const createShare = useCreateShare();
  const updateShare = useUpdateShare();
  const revokeShare = useRevokeShare();
  const { copied, copy } = useClipboard(2000);

  const users = usersQuery.data ?? [];
  const supportsDirect = capabilities.shareTypes.includes("direct");
  const supportsPublic = capabilities.shareTypes.includes("public_link");
  // A public link grants the strongest permission the resource allows:
  // download for drive (view + download), view-only for documents.
  const publicPermission: SharePermission = capabilities.permissions.includes("download") ? "download" : "view";

  const [recipientQuery, setRecipientQuery] = useState("");
  const [pendingUserIds, setPendingUserIds] = useState<string[]>([]);
  const [directPermission, setDirectPermission] = useState<DirectPermission>("edit");
  const [accessMode, setAccessMode] = useState<AccessMode>("restricted");
  const [publicSettingsOpen, setPublicSettingsOpen] = useState(false);
  const [publicExpiresIn, setPublicExpiresIn] = useState("never");
  const [publicPassword, setPublicPassword] = useState("");
  const [savingChanges, setSavingChanges] = useState(false);
  const [savingPublicSettings, setSavingPublicSettings] = useState(false);

  const publicShare = shares.find(share => share.shareType === "public_link");
  const directShares = shares.filter(share => share.shareType === "direct");
  const shareLink = publicShare ? buildShareUrl(publicShare.token) : null;
  const isPublicAccess = accessMode === "anyone";

  // Re-sync the desired-state controls whenever the server view changes
  // (after a create/revoke), mirroring the original load-then-reset.
  useEffect(() => {
    const nextPublicShare = shares.find(share => share.shareType === "public_link");
    /* eslint-disable react/set-state-in-effect -- seed desired-state controls from the loaded server view. */
    setAccessMode(nextPublicShare ? "anyone" : "restricted");
    setPublicExpiresIn(expirationValueFrom(nextPublicShare?.expiresAt));
    setPublicPassword("");
    /* eslint-enable react/set-state-in-effect */
  }, [shares]);

  const sharedUserIds = useMemo(
    () => new Set(directShares.map(share => share.sharedWithUserId).filter((id): id is string => Boolean(id))),
    [directShares],
  );
  const availableUsers = users.filter(user => user.id !== currentUser?.id && !sharedUserIds.has(user.id));
  const pendingUsers = users.filter(user => pendingUserIds.includes(user.id));
  const recipientSearch = recipientQuery.trim().toLowerCase();
  const filteredUsers = recipientSearch
    ? availableUsers.filter(user =>
        userLabel(user).toLowerCase().includes(recipientSearch)
        || user.username.toLowerCase().includes(recipientSearch))
    : [];

  const togglePendingUser = (userId: string) => {
    setPendingUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
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
          resourceType: target.resourceType,
          resourceId: target.resourceId,
          shareType: "direct",
          sharedWithUserId: userId,
          permission: directPermission,
        });
      }
      if (supportsPublic && accessMode === "anyone" && !publicShare) {
        const expiresAt = expiresAtFromValue(publicExpiresIn);
        await createShare.mutateAsync({
          resourceType: target.resourceType,
          resourceId: target.resourceId,
          shareType: "public_link",
          permission: publicPermission,
          ...(expiresAt ? { expiresAt } : {}),
          ...(publicPassword.trim() ? { password: publicPassword.trim() } : {}),
        });
      }
      if (supportsPublic && accessMode === "restricted" && publicShare)
        await revokeShare.mutateAsync(publicShare.id);
      onClose();
    }
    catch {
      // A failed create/revoke surfaces through the mutation's error state;
      // leave the dialog open (and the rejection handled) so nothing is lost.
    }
    finally {
      setSavingChanges(false);
    }
  };

  const publicDesc = publicPermission === "download"
    ? t("share:publicLinkReadOnlyDesc")
    : t("share:publicLinkViewOnlyDesc");

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-visible p-0 sm:max-w-[480px]">
        <DialogHeader className="w-full min-w-0 px-6 pt-5 pb-3">
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-10 text-xl font-medium">
            <Share2 className="size-5 shrink-0" />
            <span className="truncate">{t("share:heading")}</span>
          </DialogTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Input
                    value={target.name}
                    readOnly
                    tabIndex={-1}
                    className="h-8 w-full cursor-default rounded-none border-0 border-b border-input bg-transparent px-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
                  />
                )}
              />
              <TooltipContent side="bottom" align="start" className="max-w-[520px] break-all">
                {target.name}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DialogHeader>

        <div className="flex min-h-[120px] w-full min-w-0 flex-col gap-4 px-6 pb-5">
          {supportsDirect && (
            <section className="relative flex flex-col gap-2">
              <h3 className="text-base font-medium">{t("share:peopleWithAccess")}</h3>

              <div className="relative">
                <Input
                  value={recipientQuery}
                  onChange={event => setRecipientQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const first = filteredUsers[0];
                      if (first) {
                        togglePendingUser(first.id);
                        setRecipientQuery("");
                      }
                    }
                  }}
                  placeholder={t("share:addPeoplePlaceholder")}
                  className="h-10"
                />
                {filteredUsers.length > 0 && (
                  <div className="absolute top-11 right-0 left-0 z-30 max-h-56 overflow-auto rounded-md border bg-popover p-1 shadow-md">
                    {filteredUsers.map(user => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          togglePendingUser(user.id);
                          setRecipientQuery("");
                        }}
                        className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

              {currentUser && (
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{initials(currentUser.name || currentUser.username)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {currentUser.name || currentUser.username}
                      {" "}
                      {t("share:youSuffix")}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{currentUser.email}</p>
                  </div>
                  <span className="text-sm text-muted-foreground">{t("share:owner")}</span>
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
                      {directPermission === "edit" ? t("share:permission.edit") : t("share:permission.view")}
                    </p>
                  </div>
                  <Select value={directPermission} onValueChange={value => value && setDirectPermission(value as DirectPermission)}>
                    <SelectTrigger className="w-[120px] border-0 shadow-none">
                      <SelectValue>
                        {(v: string) => t(`share:permission.${v}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">{t("share:permission.view")}</SelectItem>
                      <SelectItem value="edit">{t("share:permission.edit")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("share:action.remove")} onClick={() => togglePendingUser(user.id)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </section>
          )}

          {supportsPublic && (
            <section className="relative flex flex-col gap-2">
              <h3 className="text-base font-medium">{t("share:generalAccess")}</h3>
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
                          {(v: string) => t(v === "anyone" ? "share:linkAnyone" : "share:linkRestricted")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="restricted">{t("share:linkRestricted")}</SelectItem>
                        <SelectItem value="anyone">{t("share:linkAnyone")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex w-[120px] justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className={isPublicAccess ? "rounded-full px-4" : "invisible rounded-full px-4"}
                        aria-expanded={publicSettingsOpen}
                        disabled={!isPublicAccess || savingChanges}
                        onClick={togglePublicSettings}
                      >
                        {t("share:publicLinkOptions")}
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {isPublicAccess ? publicDesc : t("share:linkRestrictedDesc")}
                  </p>
                </div>
              </div>

              {isPublicAccess && publicSettingsOpen && (
                <div className="absolute top-[76px] right-0 z-20 w-[360px] max-w-[calc(100vw-3rem)] rounded-xl border bg-popover p-4 shadow-lg">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{t("share:publicLinkOptions")}</p>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("common:common.close")} onClick={closePublicSettings}>
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      {t("share:expiration")}
                      <Select value={publicExpiresIn} onValueChange={value => value && setPublicExpiresIn(value)}>
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) => t(v === "never"
                              ? "share:expiresNever"
                              : v === "1"
                                ? "share:expires1Day"
                                : v === "7" ? "share:expires7Days" : "share:expires30Days")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="never">{t("share:expiresNever")}</SelectItem>
                          <SelectItem value="1">{t("share:expires1Day")}</SelectItem>
                          <SelectItem value="7">{t("share:expires7Days")}</SelectItem>
                          <SelectItem value="30">{t("share:expires30Days")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      {t("share:field.password")}
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={publicPassword}
                          onChange={event => setPublicPassword(event.currentTarget.value)}
                          placeholder={publicShare?.hasPassword ? t("share:passwordKeep") : t("share:passwordPlaceholder")}
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
                        className={publicShare?.hasPassword ? "" : "invisible"}
                        disabled={!publicShare?.hasPassword || savingPublicSettings}
                        onClick={() => void updatePublicLinkSettings(true)}
                      >
                        {t("share:action.removePassword")}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="ghost" disabled={savingPublicSettings} onClick={closePublicSettings}>
                        {t("common:common.close")}
                      </Button>
                      <Button type="button" disabled={savingPublicSettings || !publicShare} onClick={() => void updatePublicLinkSettings()}>
                        {savingPublicSettings && <Loader2 className="size-4 animate-spin" />}
                        {t("share:action.update")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {extraSection}

          {sharesLoading && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("common:common.loading")}
            </div>
          )}
        </div>

        <Separator />

        <div className="flex w-full min-w-0 items-center justify-between px-6 py-4">
          <Button
            type="button"
            variant="outline"
            className={supportsPublic ? "rounded-full" : "invisible rounded-full"}
            disabled={savingChanges || !isPublicAccess || !shareLink}
            onClick={handleCopyLink}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {t("share:action.copyLink")}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="rounded-full px-6" disabled={savingChanges} onClick={onClose}>
              {t("common:common.close")}
            </Button>
            <Button type="button" className="rounded-full px-8" disabled={savingChanges} onClick={() => void handleDone()}>
              {savingChanges && <Loader2 className="size-4 animate-spin" />}
              {t("share:action.done")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Resolve the display label for a direct share's recipient. */
function resolveShareLabel(share: ShareView, users: readonly PickableUser[]): string {
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
  readonly share: ShareView;
  readonly label: string;
  readonly onPermissionChange: (permission: SharePermission) => void;
  readonly onRemove: () => void;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation(["share", "common"]);
  const value: DirectPermission = share.permission === "edit" ? "edit" : "view";
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>{initials(label)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-sm text-muted-foreground">
          {value === "edit" ? t("share:permission.edit") : t("share:permission.view")}
        </p>
      </div>
      <Select value={value} onValueChange={next => next && onPermissionChange(next as SharePermission)} disabled={disabled}>
        <SelectTrigger className="w-[120px] border-0 shadow-none">
          <SelectValue>
            {(v: string) => t(`share:permission.${v}`)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">{t("share:permission.view")}</SelectItem>
          <SelectItem value="edit">{t("share:permission.edit")}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon" aria-label={t("share:action.revoke")} disabled={disabled} onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
