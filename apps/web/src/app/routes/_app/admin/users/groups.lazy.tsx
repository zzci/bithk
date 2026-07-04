/* eslint-disable react-refresh/only-export-components */
// Admin groups tab: user-defined groups plus the built-in Administrators and
// Default entries, with a member panel for the current selection. The form
// dialogs live in -group-dialogs.tsx, the memoized group row in
// -group-list-row.tsx, and the member panel card in -group-member-panel.tsx.

import type { AccountGroup, AccountGroupMember, AccountUser } from "@/shared/lib/api/account";
import type { ModuleKey } from "@/shared/lib/modules";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  addAccountGroupMember,
  createAccountGroup,
  deleteAccountGroup,
  getDefaultGroupModules,
  listAccountGroupMembers,
  listAccountGroups,
  listAccountUsers,
  removeAccountGroupMember,
  updateAccountGroup,
  updateAccountUser,
  updateDefaultGroupModules,
} from "@/shared/lib/api/account";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { DefaultModulesDialog, GroupFormDialog } from "./-group-dialogs";
import { MODULE_LABEL_KEY } from "./-group-labels";
import { GroupListRow } from "./-group-list-row";
import { GroupMemberPanel } from "./-group-member-panel";

export const Route = createLazyFileRoute("/_app/admin/users/groups")({
  component: GroupsTab,
});

// Selection sentinel for the built-in Administrators entry (FEAT-032): it is
// backed by `users.role = "admin"`, not a group row.
const ADMINS = "__admins__";
// Selection sentinel for the built-in Default entry (FEAT-043): the fallback
// modules for users in no group, backed by the `account.default_modules`
// setting, not a group row.
const DEFAULT = "__default__";

type Group = AccountGroup;
// The member panel shows the shared subset of the two row sources: real group
// members (AccountGroupMember) and rows synthesized from AccountUser for the
// built-in Admins entry (which carry no `joinedAt`).
type GroupMember = Pick<AccountGroupMember, "id" | "username" | "name" | "email" | "role" | "status">;
type UserSearchItem = AccountUser;

export function GroupsTab() {
  const { t } = useTranslation("groups");
  const currentUser = useAuthStore(s => s.user);
  const [groups, setGroups] = useState<readonly Group[]>([]);
  const [adminCount, setAdminCount] = useState(0);
  const [defaultModules, setDefaultModules] = useState<ModuleKey[]>([]);
  const [editDefaultOpen, setEditDefaultOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Group | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<readonly GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<readonly UserSearchItem[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isAdminsSelected = selectedId === ADMINS;
  const isDefaultSelected = selectedId === DEFAULT;
  const isBuiltinSelected = isAdminsSelected || isDefaultSelected;
  // Derive the selected group from the live list so an edit/rename reflects
  // immediately in the member panel header instead of a stale snapshot.
  const selectedGroup = !isBuiltinSelected ? groups.find(g => g.id === selectedId) ?? null : null;
  const selectionLabel = isAdminsSelected ? t("admins.name") : isDefaultSelected ? t("default.name") : selectedGroup?.name ?? null;

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups(await listAccountGroups());
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.loadFailed"));
    }
    finally {
      setLoading(false);
    }
  }, [t]);

  const fetchAdminCount = useCallback(async () => {
    try {
      const res = await listAccountUsers({ role: "admin", limit: 1 });
      setAdminCount(res.meta.total);
    }
    catch {
      // Non-fatal: the badge just stays at its last value.
    }
  }, []);

  const fetchDefaultModules = useCallback(async () => {
    try {
      // The spec types the payload as plain strings; the backend only stores
      // keys from the frontend module registry.
      setDefaultModules(await getDefaultGroupModules() as ModuleKey[]);
    }
    catch {
      // Non-fatal: the Default entry just shows its last-known modules.
    }
  }, []);

  useEffect(() => {
    void fetchGroups();
    void fetchAdminCount();
    void fetchDefaultModules();
  }, [fetchGroups, fetchAdminCount, fetchDefaultModules]);

  const fetchMembers = useCallback(async (selection: string) => {
    setMembersLoading(true);
    try {
      if (selection === ADMINS) {
        const res = await listAccountUsers({ role: "admin", limit: 100 });
        setMembers(res.data.map(u => ({ ...u, status: "active" })));
      }
      else {
        setMembers(await listAccountGroupMembers(selection));
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.loadFailed"));
    }
    finally {
      setMembersLoading(false);
    }
  }, [t]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    // The Default entry has no membership rows — its "members" are implicitly
    // every ungrouped user — so there is nothing to fetch.
    if (id !== DEFAULT)
      void fetchMembers(id);
  }, [fetchMembers]);

  const handleUserSearchChange = useCallback((q: string) => {
    setUserSearch(q);
    clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await listAccountUsers({ q, limit: 10 });
        setSearchResults(res.data);
      }
      catch {
        setSearchResults([]);
      }
    }, 300);
  }, []);

  // Promoting to Administrators only makes sense for non-admins; group adds
  // keep every candidate (the server answers 409 for existing members).
  const candidates = isAdminsSelected ? searchResults.filter(u => u.role !== "admin") : searchResults;

  const addMember = useCallback(async (userId: string) => {
    if (!selectedId)
      return;
    try {
      if (selectedId === ADMINS) {
        await updateAccountUser(userId, { role: "admin" });
        void fetchAdminCount();
      }
      else {
        await addAccountGroupMember(selectedId, userId);
        void fetchGroups();
      }
      setAddMemberOpen(false);
      setUserSearch("");
      setSearchResults([]);
      void fetchMembers(selectedId);
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
  }, [selectedId, fetchAdminCount, fetchGroups, fetchMembers, t]);

  // Removing from Administrators demotes to a regular user (the server's
  // last-admin guard answers 409 when that would leave no active admin).
  const removeMember = useCallback(async (userId: string) => {
    if (!selectedId)
      return;
    try {
      if (selectedId === ADMINS) {
        await updateAccountUser(userId, { role: "user" });
        void fetchAdminCount();
      }
      else {
        await removeAccountGroupMember(selectedId, userId);
        void fetchGroups();
      }
      void fetchMembers(selectedId);
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
  }, [selectedId, fetchAdminCount, fetchGroups, fetchMembers, t]);

  const confirmDeleteGroup = async () => {
    if (!deleteConfirm)
      return;
    try {
      await deleteAccountGroup(deleteConfirm.id);
      if (selectedId === deleteConfirm.id)
        setSelectedId(null);
      setDeleteConfirm(null);
      void fetchGroups();
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.deleteFailed"));
      setDeleteConfirm(null);
    }
  };

  const onAddMemberOpenChange = useCallback((open: boolean) => {
    setAddMemberOpen(open);
    if (!open) {
      setUserSearch("");
      setSearchResults([]);
    }
  }, []);

  // Row callbacks are stable so the memoized GroupListRow only re-renders when
  // its own group / selection / editing state changes.
  const onEditOpenChange = useCallback((group: Group, open: boolean) => {
    setEditGroup(open ? group : null);
  }, []);

  const onSubmitEdit = useCallback(async (group: Group, name: string, description: string, modules: readonly ModuleKey[]) => {
    await updateAccountGroup(group.id, { name, description: description || undefined, modules });
    setEditGroup(null);
    void fetchGroups();
  }, [fetchGroups]);

  const onDeleteRow = useCallback((group: Group) => setDeleteConfirm(group), []);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm", { name: deleteConfirm?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
            <Button variant="destructive" onClick={() => void confirmDeleteGroup()}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Group list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>{t("listTitle")}</CardTitle>
                <CardDescription>{t("listDescription")}</CardDescription>
              </div>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger render={(
                  <Button>
                    <Plus className="mr-1 size-4" />
                    {t("create")}
                  </Button>
                )}
                />
                <DialogContent>
                  <GroupFormDialog
                    onSubmit={async (name, description, modules) => {
                      await createAccountGroup({ name, description: description || undefined, modules });
                      setCreateOpen(false);
                      void fetchGroups();
                    }}
                    title={t("createTitle")}
                    description={t("createDescription")}
                    submitLabel={t("create")}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {loading
              ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              : (
                  <div className="space-y-1.5">
                    {/* Built-in Administrators entry: backed by users.role,
                        full access, not editable or deletable. */}
                    <div
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors",
                        isAdminsSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isAdminsSelected}
                      onClick={() => select(ADMINS)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(ADMINS);
                        }
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="font-medium truncate">{t("admins.name")}</span>
                          <Badge variant="outline" className="shrink-0 text-xs">{t("system")}</Badge>
                          <Badge variant="secondary" className="shrink-0">{adminCount}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{t("admins.description")}</p>
                      </div>
                    </div>

                    {/* Built-in Default entry (FEAT-043): the fallback modules
                        for users in no group. Editable modules, no members,
                        not deletable. */}
                    <div
                      className={cn(
                        "group flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors",
                        isDefaultSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isDefaultSelected}
                      onClick={() => select(DEFAULT)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(DEFAULT);
                        }
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="font-medium truncate">{t("default.name")}</span>
                          <Badge variant="outline" className="shrink-0 text-xs">{t("system")}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{t("default.description")}</p>
                        {defaultModules.length > 0 && (
                          <p className="text-xs text-muted-foreground truncate">
                            {defaultModules.map(k => t(MODULE_LABEL_KEY[k])).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div
                        className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[active=true]:opacity-100"
                        data-active={isDefaultSelected}
                        onClick={e => e.stopPropagation()}
                      >
                        <Dialog open={editDefaultOpen} onOpenChange={setEditDefaultOpen}>
                          <DialogTrigger
                            render={(
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("default.edit")}
                                onClick={() => setEditDefaultOpen(true)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            )}
                          />
                          <DialogContent>
                            <DefaultModulesDialog
                              initialModules={defaultModules}
                              onSubmit={async (modules) => {
                                setDefaultModules(await updateDefaultGroupModules(modules) as ModuleKey[]);
                                setEditDefaultOpen(false);
                              }}
                              title={t("default.editTitle")}
                              description={t("default.editDescription")}
                              submitLabel={t("common.save")}
                            />
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>

                    {groups.length === 0 && (
                      <p className="px-1 text-sm text-muted-foreground">{t("noResults")}</p>
                    )}
                    {groups.map(group => (
                      <GroupListRow
                        key={group.id}
                        group={group}
                        active={selectedId === group.id}
                        editing={editGroup?.id === group.id}
                        onSelect={select}
                        onEditOpenChange={onEditOpenChange}
                        onSubmitEdit={onSubmitEdit}
                        onDelete={onDeleteRow}
                      />
                    ))}
                  </div>
                )}
          </CardContent>
        </Card>

        {/* Member panel */}
        <GroupMemberPanel
          selectedId={selectedId}
          selectionLabel={selectionLabel}
          isAdminsSelected={isAdminsSelected}
          isDefaultSelected={isDefaultSelected}
          members={members}
          membersLoading={membersLoading}
          currentUserId={currentUser?.id}
          addMemberOpen={addMemberOpen}
          onAddMemberOpenChange={onAddMemberOpenChange}
          userSearch={userSearch}
          onUserSearchChange={handleUserSearchChange}
          candidates={candidates}
          onAddMember={userId => void addMember(userId)}
          onRemoveMember={userId => void removeMember(userId)}
        />
      </div>
    </div>
  );
}
