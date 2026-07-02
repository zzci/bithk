/* eslint-disable react-refresh/only-export-components */
import type { AccountUser } from "@/shared/lib/api/account";
import { createLazyFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiTokensPanel } from "@/shared/components/api-tokens-panel";
import { ListFilter } from "@/shared/components/list-filter";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { createAccountUser, deleteAccountUser, updateAccountUser, useAccountUsers } from "@/shared/lib/api/account";
import { formatDateTime } from "@/shared/lib/format";
import { useAuthStore } from "@/shared/stores/auth";

export const Route = createLazyFileRoute("/_app/admin/users/")({
  component: UsersTab,
});

const ALL = "__all__";

type User = AccountUser;

function UsersTab() {
  const { t } = useTranslation(["users", "tokens"]);
  const currentUser = useAuthStore(s => s.user);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  // Mutation failures overlay the list query's own load error; cleared when
  // the next mutation attempt starts (the query clears itself on refetch).
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [tokenTarget, setTokenTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const usersQuery = useAccountUsers({
    q: debouncedSearch || undefined,
    role: roleFilter !== ALL ? roleFilter : undefined,
    status: statusFilter !== ALL ? statusFilter : undefined,
    page,
    limit: 20,
  });
  const users = usersQuery.data?.data ?? [];
  const meta = {
    total: usersQuery.data?.meta.total ?? 0,
    totalPages: usersQuery.data?.meta.totalPages ?? 0,
  };
  // `isPending` covers the first load only; page/filter changes keep the
  // previous rows on screen (placeholderData: keepPreviousData).
  const loading = usersQuery.isPending;
  const error = actionError
    ?? (usersQuery.error
      ? (usersQuery.error instanceof Error ? usersQuery.error.message : t("common.error.loadFailed"))
      : null);
  const refetchUsers = () => void usersQuery.refetch();

  const toggleStatus = async (user: User) => {
    setActionError(null);
    try {
      const newStatus = user.status === "active" ? "disabled" : "active";
      await updateAccountUser(user.id, { status: newStatus });
      refetchUsers();
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget)
      return;
    setDeleting(true);
    try {
      await deleteAccountUser(deleteTarget.id);
      toast.success(t("virtual.toast.deleted"));
      setDeleteTarget(null);
      refetchUsers();
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
    finally {
      setDeleting(false);
    }
  };

  const isSelf = (userId: string) => currentUser?.id === userId;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>

        <ListFilter
          dimensions={[
            {
              key: "role",
              label: t("field.role"),
              mode: "single",
              defaultValue: ALL,
              value: roleFilter,
              onChange: (value) => {
                setRoleFilter(value ?? ALL);
                setPage(1);
              },
              options: [
                { value: "admin", label: t("roleAdmin") },
                { value: "user", label: t("roleUser") },
              ],
            },
            {
              key: "status",
              label: t("field.status"),
              mode: "single",
              defaultValue: ALL,
              value: statusFilter,
              onChange: (value) => {
                setStatusFilter(value ?? ALL);
                setPage(1);
              },
              options: [
                { value: "active", label: t("statusActive") },
                { value: "disabled", label: t("statusDisabled") },
              ],
            },
          ]}
        />

        <span className="text-sm text-muted-foreground">
          {t("totalCount", { count: meta.total })}
        </span>

        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t("virtual.create")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.username")}</TableHead>
              <TableHead>{t("col.name")}</TableHead>
              <TableHead>{t("col.email")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead>{t("col.groups")}</TableHead>
              <TableHead>{t("col.lastLogin")}</TableHead>
              <TableHead>{t("col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={loading}>
            {loading
              ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                )
              : users.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        {t("noResults")}
                      </TableCell>
                    </TableRow>
                  )
                : users.map(user => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{user.username}</span>
                          {user.role === "admin" && (
                            <Badge variant="default" className="text-2xs px-1 py-0">
                              {t("roleAdmin")}
                            </Badge>
                          )}
                          {user.isVirtual && (
                            <Badge variant="secondary" className="text-2xs px-1 py-0">
                              {t("virtual.badge")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={user.status === "active" ? "default" : "destructive"}>
                          {t(`status${user.status === "active" ? "Active" : "Disabled"}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(user.groups ?? []).map(g => (
                            <Badge key={g.id} variant="outline" className="text-xs">
                              {g.name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => setTokenTarget(user)}>
                            <KeyRound className="mr-1 size-3.5" />
                            {t("tokens:title")}
                          </Button>
                          {user.isVirtual
                            ? (
                                <>
                                  <Button variant="ghost" onClick={() => setEditTarget(user)}>
                                    {t("virtual.edit")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => setDeleteTarget(user)}
                                  >
                                    {t("virtual.delete")}
                                  </Button>
                                </>
                              )
                            : (
                                <>
                                  <Button variant="ghost" onClick={() => setEditTarget(user)}>
                                    {t("edit")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={isSelf(user.id)}
                                    onClick={() => void toggleStatus(user)}
                                  >
                                    {user.status === "active" ? t("disable") : t("enable")}
                                  </Button>
                                </>
                              )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
      </div>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            {t("common.prev")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {page}
            {" / "}
            {meta.totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= meta.totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}

      {createOpen && (
        <VirtualUserDialog
          mode="create"
          open
          onOpenChange={open => !open && setCreateOpen(false)}
          onSaved={refetchUsers}
        />
      )}
      {editTarget && (
        <VirtualUserDialog
          mode="edit"
          user={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
          onSaved={refetchUsers}
        />
      )}

      {tokenTarget && (
        <Dialog open onOpenChange={open => !open && setTokenTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{`${t("tokens:title")} · ${tokenTarget.name}`}</DialogTitle>
              <DialogDescription className="sr-only">{t("tokens:title")}</DialogDescription>
            </DialogHeader>
            <ApiTokensPanel target={{ kind: "user", userId: tokenTarget.id }} />
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("virtual.deleteTitle")}
        description={t("virtual.deleteConfirm", { name: deleteTarget?.name })}
        pending={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

interface VirtualUserDialogProps {
  readonly mode: "create" | "edit";
  readonly user?: User;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
}

function VirtualUserDialog({ mode, user, open, onOpenChange, onSaved }: VirtualUserDialogProps) {
  const { t } = useTranslation("users");
  // Identity fields (username, email) are editable only for virtual rows;
  // a real user's identity is owned by the IdP, so the dialog edits its name
  // alone. Create mode always targets a new virtual user.
  const isVirtual = mode === "create" || (user?.isVirtual ?? false);
  const [username, setUsername] = useState(user?.username ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || pending || (isVirtual && !trimmedUsername))
      return;
    setPending(true);
    setError(null);
    try {
      if (mode === "create") {
        await createAccountUser({
          username: trimmedUsername,
          name: trimmedName,
          ...(trimmedEmail ? { email: trimmedEmail } : {}),
        });
        toast.success(t("virtual.toast.created"));
      }
      else if (user) {
        const body = isVirtual
          ? { username: trimmedUsername, name: trimmedName, email: trimmedEmail }
          : { name: trimmedName };
        await updateAccountUser(user.id, body);
        toast.success(isVirtual ? t("virtual.toast.updated") : t("toast.updated"));
      }
      onOpenChange(false);
      onSaved();
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
    finally {
      setPending(false);
    }
  };

  const title = mode === "create"
    ? t("virtual.createTitle")
    : isVirtual ? t("virtual.editTitle") : t("editTitle");
  const description = isVirtual ? t("virtual.dialogDescription") : t("editDescription");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {isVirtual && (
            <div className="space-y-1.5">
              <Label htmlFor="virtual-user-username">{t("field.username")}</Label>
              <Input
                id="virtual-user-username"
                autoFocus
                required
                maxLength={50}
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase())}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="virtual-user-name">{t("field.name")}</Label>
            <Input
              id="virtual-user-name"
              autoFocus={!isVirtual}
              required
              maxLength={255}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {isVirtual && (
            <div className="space-y-1.5">
              <Label htmlFor="virtual-user-email">{t("field.email")}</Label>
              <Input
                id="virtual-user-email"
                type="email"
                maxLength={255}
                value={email}
                placeholder={t("virtual.emailPlaceholder")}
                onChange={e => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("virtual.emailHint")}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || (isVirtual && !username.trim())}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
