// Roles settings section: list project roles, create/edit/delete custom roles
// with capability checkboxes. System roles (`isSystem`) are read-only and
// cannot be deleted.

import type { ProjectCapability, ProjectRoleView } from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import {
  PROJECT_CAPABILITIES,
  useCreateProjectRole,
  useDeleteProjectRole,
  useProjectRoles,
  useUpdateProjectRole,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

// Capabilities grouped by their module prefix (the segment before the ".").
// Derived from PROJECT_CAPABILITIES so new capabilities slot into their module
// automatically; the stored payload stays a flat capabilities[] regardless.
const CAPABILITY_GROUPS: ReadonlyArray<readonly [string, readonly ProjectCapability[]]> = (() => {
  const order: string[] = [];
  const byModule = new Map<string, ProjectCapability[]>();
  for (const cap of PROJECT_CAPABILITIES) {
    const module = cap.split(".")[0] ?? cap;
    const existing = byModule.get(module);
    if (existing) {
      existing.push(cap);
    }
    else {
      byModule.set(module, [cap]);
      order.push(module);
    }
  }
  return order.map(module => [module, byModule.get(module)!] as const);
})();

interface ProjectSettingsRolesProps {
  readonly projectId: string;
  readonly canManage: boolean;
}

export function ProjectSettingsRoles({ projectId, canManage }: ProjectSettingsRolesProps) {
  const { t } = useTranslation(["projects", "common"]);
  const rolesQuery = useProjectRoles(projectId);
  const deleteRole = useDeleteProjectRole();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectRoleView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRoleView | null>(null);

  const roles = rolesQuery.data ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("roles.add")}
          </Button>
        </div>
      )}

      {rolesQuery.error && <ErrorBanner message={errorMessage(rolesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="space-y-3">
        {roles.length === 0
          ? <p className="text-sm text-muted-foreground">{t("roles.empty")}</p>
          : roles.map(role => (
              <div key={role.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{role.isSystem ? t("roles.owner") : role.name}</span>
                      {role.isSystem && <Badge variant="outline" className="text-xs">{t("roles.system")}</Badge>}
                    </div>
                    {/* The system owner role holds every capability and is
                        capability-locked; the badge list is noise, so we omit it
                        and only show capabilities for custom roles. */}
                    {!role.isSystem && (
                      <div className="flex flex-wrap gap-1">
                        {role.capabilities.length === 0
                          ? <span className="text-xs text-muted-foreground">{t("roles.noCapabilities")}</span>
                          : role.capabilities.map(cap => (
                              <Badge key={cap} variant="secondary" className="text-xs">{t(`capability.${cap}` as const)}</Badge>
                            ))}
                      </div>
                    )}
                  </div>
                  {canManage && !role.isSystem && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditTarget(role)}>
                        {t("common:common.edit")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(role)}>
                        {t("common:common.delete")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("roles.delete.title")}
        description={t("roles.delete.confirm", { name: deleteTarget?.name })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteRole.mutate({ projectId, roleId: deleteTarget.id }, {
              onSuccess: () => toast.success(t("toast.roleDeleted")),
              onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
            });
            setDeleteTarget(null);
          }
        }}
      />

      {canManage && (
        <>
          <RoleDialog
            projectId={projectId}
            mode="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
          {editTarget && (
            <RoleDialog
              projectId={projectId}
              mode="edit"
              role={editTarget}
              open
              onOpenChange={open => !open && setEditTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

interface RoleDialogProps {
  readonly projectId: string;
  readonly mode: "create" | "edit";
  readonly role?: ProjectRoleView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function RoleDialog({ projectId, mode, role, open, onOpenChange }: RoleDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createRole = useCreateProjectRole();
  const updateRole = useUpdateProjectRole();

  const [name, setName] = useState(role?.name ?? "");
  const [capabilities, setCapabilities] = useState<readonly ProjectCapability[]>(role?.capabilities ?? []);

  const pending = createRole.isPending || updateRole.isPending;
  const error = createRole.error ?? updateRole.error;

  const toggle = (cap: ProjectCapability) => {
    setCapabilities(prev =>
      prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap],
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    if (mode === "create") {
      createRole.mutate({ projectId, name: name.trim(), capabilities }, {
        onSuccess: () => {
          toast.success(t("toast.roleCreated"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (role) {
      updateRole.mutate({ projectId, roleId: role.id, name: name.trim(), capabilities }, {
        onSuccess: () => {
          toast.success(t("toast.roleUpdated"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("roles.createTitle") : t("roles.editTitle")}</DialogTitle>
            <DialogDescription>{t("roles.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="role-name">{t("roles.field.name")}</Label>
            <Input id="role-name" autoFocus required value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>{t("roles.field.capabilities")}</Label>
            <div className="space-y-4 rounded-md border p-3">
              {CAPABILITY_GROUPS.map(([module, caps]) => (
                <fieldset key={module} className="space-y-2">
                  <legend className="text-xs font-medium text-muted-foreground">
                    {t(`capabilityGroup.${module}` as const)}
                  </legend>
                  {caps.map(cap => (
                    <div key={cap} className="flex items-center justify-between gap-2">
                      <Label htmlFor={`cap-${cap}`} className="text-sm font-normal">{t(`capability.${cap}` as const)}</Label>
                      <Switch
                        id={`cap-${cap}`}
                        checked={capabilities.includes(cap)}
                        onCheckedChange={() => toggle(cap)}
                      />
                    </div>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {mode === "create" ? t("common:common.add") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
