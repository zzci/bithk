// Admin global-roles page (PLAN-076): an in-page role editor mirroring the
// project-role settings pattern (PLAN-065). A Select dropdown chooses which
// role to edit — a "+ New role" entry creates one, every existing role loads
// into the inline editor below with a module visibility switch table. The
// system default role (kind === "default") is fully editable but undeletable.

import type { GlobalRoleView, ModuleKey } from "@/shared/lib/api/global-roles";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
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

// Sentinel selection value for the "+ New role" (create) entry in the dropdown.
const NEW_ROLE = "__new__";

export function GlobalRolesPage() {
  const { t } = useTranslation(["roles", "common"]);
  const rolesQuery = useGlobalRoles();
  const deleteRole = useDeleteGlobalRole();

  // Which role is loaded into the inline editor: NEW_ROLE (create) or a role id.
  const [selectedId, setSelectedId] = useState<string>(NEW_ROLE);
  // Bumped to force the keyed editor to re-mount (reset its form) after a
  // create/delete even when the effective selection string is unchanged.
  const [resetNonce, setResetNonce] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<GlobalRoleView | null>(null);

  const roles = rolesQuery.data ?? [];
  const options = [NEW_ROLE, ...roles.map(r => r.id)];
  const effectiveId = options.includes(selectedId) ? selectedId : NEW_ROLE;
  const effectiveRole = roles.find(r => r.id === effectiveId) ?? null;

  const labelForId = (id: string) => {
    if (id === NEW_ROLE)
      return t("roles:create");
    return roles.find(r => r.id === id)?.name ?? id;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("roles:page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("roles:page.description")}</p>
      </div>

      {rolesQuery.error && <ErrorBanner message={errorMessage(rolesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="space-y-1.5">
        <Label>{t("roles:selectRole")}</Label>
        <Select value={effectiveId} onValueChange={v => v !== null && setSelectedId(v)}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue>
              {(v: string) => labelForId(v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_ROLE}>
              <Plus className="size-4" />
              {t("roles:create")}
            </SelectItem>
            {roles.map(r => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RoleEditor
        key={`${effectiveId}:${resetNonce}`}
        role={effectiveRole}
        onCreated={() => {
          setSelectedId(NEW_ROLE);
          setResetNonce(n => n + 1);
        }}
        onRequestDelete={setDeleteTarget}
      />

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
                setSelectedId(NEW_ROLE);
                setResetNonce(n => n + 1);
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

interface RoleEditorProps {
  // The role loaded into the editor, or null for create mode.
  readonly role: GlobalRoleView | null;
  readonly onCreated: () => void;
  readonly onRequestDelete: (role: GlobalRoleView) => void;
}

function RoleEditor({ role, onCreated, onRequestDelete }: RoleEditorProps) {
  const { t } = useTranslation(["roles", "common"]);
  const createRole = useCreateGlobalRole();
  const updateRole = useUpdateGlobalRole();

  const isCreate = role === null;
  const isSystem = role?.isSystem ?? false;

  const [name, setName] = useState(role?.name ?? "");
  const [modules, setModules] = useState<readonly ModuleKey[]>(role?.modules ?? []);

  const pending = createRole.isPending || updateRole.isPending;
  const error = createRole.error ?? updateRole.error;

  const toggleModule = (key: ModuleKey) => {
    setModules(prev =>
      prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key],
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    // Persist modules in registry order so the stored set is deterministic.
    const orderedModules = MODULE_KEYS.filter(key => modules.includes(key));
    if (isCreate) {
      createRole.mutate({ name: name.trim(), modules: orderedModules }, {
        onSuccess: () => {
          toast.success(t("roles:toast.created"));
          onCreated();
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else {
      updateRole.mutate({ id: role.id, name: name.trim(), modules: orderedModules }, {
        onSuccess: () => toast.success(t("roles:toast.updated")),
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{isCreate ? t("roles:createTitle") : t("roles:editTitle")}</h3>
          {isSystem && <Badge variant="outline" className="text-xs">{t("roles:system")}</Badge>}
        </div>
        {/* The default role backs every user without an explicit assignment. */}
        {role?.kind === "default" && (
          <p className="text-xs text-muted-foreground">{t("roles:defaultRoleNote")}</p>
        )}
      </div>

      {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

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
                      onCheckedChange={() => toggleModule(key)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* The system default role must always exist; only custom roles delete. */}
        {!isCreate
          ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSystem}
                onClick={() => onRequestDelete(role)}
              >
                {t("common:common.delete")}
              </Button>
            )
          : <span />}
        <Button type="submit" disabled={pending || !name.trim()}>
          {t("common:common.save")}
        </Button>
      </div>
    </form>
  );
}
