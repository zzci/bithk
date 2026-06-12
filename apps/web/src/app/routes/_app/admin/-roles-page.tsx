// Admin global-roles page (FEAT-031): a user-group style surface mirroring
// the admin groups page. Left card lists the roles — the synthetic Admin
// entry (backed by `users.role`, no role row), the locked zero-module Guest
// default, then custom roles — each with a member-count badge. Right card
// shows the selected role's members with search-add and remove. Role
// permissions (name + module switches) edit in a dialog.

import type { GlobalRoleView, ModuleKey } from "@/shared/lib/api/global-roles";
import type { ApiListEnvelope } from "@/shared/lib/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
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
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableRow } from "@/shared/components/ui/table";
import {
  MODULE_KEYS,
  useCreateGlobalRole,
  useDeleteGlobalRole,
  useGlobalRoles,
  useUpdateGlobalRole,
} from "@/shared/lib/api/global-roles";
import { errorMessage } from "@/shared/lib/errors";
import { http } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";

// Selection sentinel for the synthetic Admin entry (it has no role id).
const ADMIN_SELECTION = "__admin__";

interface RoleUserItem {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly role: "admin" | "user";
  readonly globalRoleId: string | null;
}

type UsersListResponse = ApiListEnvelope<RoleUserItem>;

const memberKeys = {
  list: (selection: string) => ["global-role-members", selection] as const,
  adminCount: ["global-role-admin-count"] as const,
};

export function GlobalRolesPage() {
  const { t } = useTranslation(["roles", "common"]);
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const rolesQuery = useGlobalRoles();
  const deleteRole = useDeleteGlobalRole();

  // ADMIN_SELECTION, a role id, or null (nothing selected yet).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Role loaded into the permissions dialog: a role view or the Admin sentinel.
  const [permTarget, setPermTarget] = useState<GlobalRoleView | "admin" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalRoleView | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<RoleUserItem[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const roles = rolesQuery.data ?? [];
  const guestRole = roles.find(r => r.kind === "default") ?? null;
  const customRoles = roles.filter(r => r.kind !== "default");

  // The synthetic Admin entry's count comes from the users list meta.
  const adminCountQuery = useQuery({
    queryKey: memberKeys.adminCount,
    queryFn: () => http<UsersListResponse>("/account/users?role=admin&limit=1").then(r => r.meta.total),
    staleTime: 5_000,
  });

  const selectedRole = selectedId !== null && selectedId !== ADMIN_SELECTION
    ? roles.find(r => r.id === selectedId) ?? null
    : null;
  const isAdminSelected = selectedId === ADMIN_SELECTION;
  const isGuestSelected = selectedRole?.kind === "default";
  const selectionLabel = isAdminSelected ? t("roles:adminRole.name") : selectedRole?.name ?? null;

  const membersQuery = useQuery({
    queryKey: memberKeys.list(selectedId ?? "none"),
    enabled: selectedId !== null,
    queryFn: () => {
      const query = isAdminSelected
        ? "role=admin&limit=100"
        : `global_role_id=${encodeURIComponent(selectedId!)}&limit=100`;
      return http<UsersListResponse>(`/account/users?${query}`);
    },
    staleTime: 5_000,
  });
  const members = membersQuery.data?.data ?? [];
  const membersTotal = membersQuery.data?.meta.total ?? 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["global-roles"] });
    void queryClient.invalidateQueries({ queryKey: ["global-role-members"] });
    void queryClient.invalidateQueries({ queryKey: memberKeys.adminCount });
  };

  const handleUserSearchChange = (q: string) => {
    setUserSearch(q);
    clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await http<UsersListResponse>(`/account/users?q=${encodeURIComponent(q)}&limit=10`);
        setSearchResults([...res.data]);
      }
      catch {
        setSearchResults([]);
      }
    }, 300);
  };

  // Candidates not already in the selected role. Admins never appear as
  // candidates for plain roles (they belong to the synthetic Admin entry).
  const candidates = searchResults.filter((u) => {
    if (isAdminSelected)
      return u.role !== "admin";
    return u.role !== "admin" && u.globalRoleId !== selectedId;
  });

  const closeAddMember = () => {
    setAddMemberOpen(false);
    setUserSearch("");
    setSearchResults([]);
  };

  const addMember = async (user: RoleUserItem) => {
    try {
      await http(`/account/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify(isAdminSelected ? { role: "admin" } : { globalRoleId: selectedId }),
      });
      toast.success(t("roles:toast.memberAdded"));
      closeAddMember();
      refresh();
    }
    catch (err) {
      toast.error(errorMessage(err, t("common:common.error.operationFailed")));
    }
  };

  // Removing from Admin demotes to a regular user; removing from a custom
  // role resets the assignment to the Guest fallback (`globalRoleId: null`).
  const removeMember = async (user: RoleUserItem) => {
    try {
      await http(`/account/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify(isAdminSelected ? { role: "user" } : { globalRoleId: null }),
      });
      toast.success(t("roles:toast.memberRemoved"));
      refresh();
    }
    catch (err) {
      toast.error(errorMessage(err, t("common:common.error.operationFailed")));
    }
  };

  const roleRow = (key: string, label: string, count: number | undefined, opts: {
    readonly system?: boolean;
    readonly icon?: React.ReactNode;
    readonly onEditPermissions: () => void;
    readonly onDelete?: (() => void) | undefined;
  }) => {
    const active = selectedId === key;
    const select = () => setSelectedId(key);
    return (
      <div
        key={key}
        className={cn(
          "group flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors",
          active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        )}
        role="button"
        tabIndex={0}
        aria-pressed={active}
        onClick={select}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {opts.icon}
            <span className="font-medium truncate">{label}</span>
            {opts.system && <Badge variant="outline" className="shrink-0 text-xs">{t("roles:system")}</Badge>}
            <Badge variant="secondary" className="shrink-0">{count ?? 0}</Badge>
          </div>
        </div>
        <div
          className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[active=true]:opacity-100"
          data-active={active}
          onClick={e => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("roles:permissions.edit", { name: label })}
            onClick={opts.onEditPermissions}
          >
            <Pencil className="size-3.5" />
          </Button>
          {opts.onDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common:common.delete")}
              className="text-destructive hover:text-destructive"
              onClick={opts.onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("roles:page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("roles:page.description")}</p>
      </div>

      {rolesQuery.error && <ErrorBanner message={errorMessage(rolesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Role list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>{t("roles:listTitle")}</CardTitle>
                <CardDescription>{t("roles:listDescription")}</CardDescription>
              </div>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger render={(
                  <Button>
                    <Plus className="mr-1 size-4" />
                    {t("roles:create")}
                  </Button>
                )}
                />
                <DialogContent>
                  <RoleFormDialog
                    role={null}
                    onDone={() => {
                      setCreateOpen(false);
                      refresh();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {rolesQuery.isLoading
              ? <p className="text-sm text-muted-foreground">{t("common:common.loading")}</p>
              : (
                  <div className="space-y-1.5">
                    {roleRow(ADMIN_SELECTION, t("roles:adminRole.name"), adminCountQuery.data, {
                      system: true,
                      icon: <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
                      onEditPermissions: () => setPermTarget("admin"),
                    })}
                    {guestRole && roleRow(guestRole.id, guestRole.name, guestRole.userCount, {
                      system: true,
                      onEditPermissions: () => setPermTarget(guestRole),
                    })}
                    {customRoles.map(r => roleRow(r.id, r.name, r.userCount, {
                      onEditPermissions: () => setPermTarget(r),
                      onDelete: () => setDeleteTarget(r),
                    }))}
                  </div>
                )}
          </CardContent>
        </Card>

        {/* Member panel */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {selectionLabel ? t("roles:membersOf", { name: selectionLabel }) : t("roles:membersTitle")}
                </CardTitle>
                <CardDescription>
                  {isGuestSelected ? t("roles:guestMembersNote") : t("roles:membersDescription")}
                </CardDescription>
              </div>
              {/* Guest is the fallback bucket — membership is not managed directly. */}
              {selectedId !== null && !isGuestSelected && (
                <Dialog
                  open={addMemberOpen}
                  onOpenChange={(open) => {
                    if (open)
                      setAddMemberOpen(true);
                    else closeAddMember();
                  }}
                >
                  <DialogTrigger render={(
                    <Button>
                      <UserPlus className="mr-1 size-4" />
                      {t("roles:addMember")}
                    </Button>
                  )}
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("roles:addMemberTitle", { name: selectionLabel })}</DialogTitle>
                      <DialogDescription>
                        {isAdminSelected ? t("roles:addAdminDescription") : t("roles:addMemberDescription")}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <Input
                        placeholder={t("roles:searchUserPlaceholder")}
                        value={userSearch}
                        onChange={e => handleUserSearchChange(e.target.value)}
                      />
                      {candidates.length > 0 && (
                        <div className="max-h-48 overflow-y-auto rounded-md border">
                          {candidates.map(u => (
                            <Button
                              key={u.id}
                              type="button"
                              variant="ghost"
                              className="h-auto w-full justify-between rounded-none px-3 py-2 text-left text-sm font-normal transition-colors hover:bg-muted"
                              onClick={() => void addMember(u)}
                            >
                              <div>
                                <div className="font-medium">{u.name}</div>
                                <div className="text-xs text-muted-foreground">{u.email}</div>
                              </div>
                              <Plus className="size-4 text-muted-foreground" />
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selectedId === null
              ? <p className="text-sm text-muted-foreground">{t("roles:selectRolePrompt")}</p>
              : membersQuery.isLoading
                ? <p className="text-sm text-muted-foreground">{t("common:common.loading")}</p>
                : members.length === 0
                  ? <p className="text-sm text-muted-foreground">{t("roles:noMembers")}</p>
                  : (
                      <div className="space-y-1.5">
                        {members.map(member => (
                          <div
                            key={member.id}
                            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{member.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {member.username}
                                {" · "}
                                {member.email}
                              </p>
                            </div>
                            {/* Guest members cannot be "removed" (it is the
                                fallback); the caller cannot modify itself. */}
                            {!isGuestSelected && member.id !== currentUser?.id && (
                              <Button
                                variant="ghost"
                                onClick={() => void removeMember(member)}
                                className="shrink-0 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="mr-1 size-3.5" />
                                {t("roles:removeMember")}
                              </Button>
                            )}
                          </div>
                        ))}
                        {membersTotal > members.length && (
                          <p className="text-xs text-muted-foreground">
                            {t("roles:moreMembers", { count: membersTotal - members.length })}
                          </p>
                        )}
                      </div>
                    )}
          </CardContent>
        </Card>
      </div>

      {/* Permissions dialog (view/edit) */}
      <Dialog
        open={permTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setPermTarget(null);
        }}
      >
        <DialogContent>
          {permTarget !== null && (
            <RoleFormDialog
              role={permTarget}
              onDone={() => {
                setPermTarget(null);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("roles:delete.title")}
        description={t("roles:delete.confirm", { name: deleteTarget?.name })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteRole.mutate(deleteTarget.id, {
              onSuccess: () => {
                toast.success(t("roles:toast.deleted"));
                if (selectedId === deleteTarget.id)
                  setSelectedId(null);
                refresh();
              },
              onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
            });
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}

interface RoleFormDialogProps {
  // null → create a custom role; "admin" → the synthetic Admin entry
  // (read-only, full access); a system role view → read-only (Guest);
  // a custom role view → editable.
  readonly role: GlobalRoleView | "admin" | null;
  readonly onDone: () => void;
}

function RoleFormDialog({ role, onDone }: RoleFormDialogProps) {
  const { t } = useTranslation(["roles", "common"]);
  const createRole = useCreateGlobalRole();
  const updateRole = useUpdateGlobalRole();

  const isAdmin = role === "admin";
  const roleView = isAdmin ? null : role;
  const isCreate = role === null;
  const readOnly = isAdmin || (roleView?.isSystem ?? false);

  const [name, setName] = useState(roleView?.name ?? "");
  const [modules, setModules] = useState<readonly ModuleKey[]>(
    isAdmin ? MODULE_KEYS : roleView?.modules ?? [],
  );

  const pending = createRole.isPending || updateRole.isPending;
  const error = createRole.error ?? updateRole.error;

  const toggleModule = (key: ModuleKey) => {
    if (readOnly)
      return;
    setModules(prev =>
      prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key],
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly || !name.trim() || pending)
      return;
    // Persist modules in registry order so the stored set is deterministic.
    const orderedModules = MODULE_KEYS.filter(key => modules.includes(key));
    if (isCreate) {
      createRole.mutate({ name: name.trim(), modules: orderedModules }, {
        onSuccess: () => {
          toast.success(t("roles:toast.created"));
          onDone();
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else {
      updateRole.mutate({ id: roleView!.id, name: name.trim(), modules: orderedModules }, {
        onSuccess: () => {
          toast.success(t("roles:toast.updated"));
          onDone();
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  const title = isCreate
    ? t("roles:createTitle")
    : isAdmin
      ? t("roles:adminRole.name")
      : roleView!.name;
  const description = isAdmin
    ? t("roles:adminRole.note")
    : roleView?.kind === "default"
      ? t("roles:guestRoleNote")
      : t("roles:permissions.description");

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

        {!readOnly && (
          <div className="space-y-1.5">
            <Label htmlFor="global-role-name">{t("roles:field.name")}</Label>
            <Input
              id="global-role-name"
              required
              maxLength={100}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
        )}

        {/* Module visibility table: one switch per registered module key. */}
        <div className="space-y-2">
          <Label>{t("roles:field.modules")}</Label>
          <div className="rounded-md border">
            <Table>
              <TableBody>
                {MODULE_KEYS.map(key => (
                  <TableRow key={key}>
                    <TableCell className="align-middle">
                      <Label htmlFor={`module-${key}`} className="font-normal">{t(`roles:modules.${key}`)}</Label>
                    </TableCell>
                    <TableCell>
                      <Switch
                        id={`module-${key}`}
                        checked={modules.includes(key)}
                        disabled={readOnly}
                        onCheckedChange={() => toggleModule(key)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={(
          <Button type="button" variant="outline">
            {readOnly ? t("common:common.close") : t("common:common.cancel")}
          </Button>
        )}
        />
        {!readOnly && (
          <Button type="submit" disabled={pending || !name.trim()}>
            {t("common:common.save")}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
