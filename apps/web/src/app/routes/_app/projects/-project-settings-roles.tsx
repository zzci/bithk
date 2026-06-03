// Roles settings section: list project roles, create/edit/delete custom roles
// with per-module radio tier selectors + admin capability toggles.
// System roles (`isSystem`) are read-only and cannot be deleted.

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
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Switch } from "@/shared/components/ui/switch";
import {
  useCreateProjectRole,
  useDeleteProjectRole,
  useProjectRoles,
  useUpdateProjectRole,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { systemRoleLabel } from "./-member-helpers";

// ---------------------------------------------------------------------------
// Module tier definitions
// Each tier is cumulative: selecting a tier replaces that module's caps with
// the full cumulative set for that tier.
// ---------------------------------------------------------------------------

type IssueTier = "none" | "view" | "comment" | "manage";
type ProcurementTier = "none" | "view" | "comment" | "manage";
type FilesTier = "none" | "view" | "manage";

const ISSUE_TIERS: Record<IssueTier, readonly ProjectCapability[]> = {
  none: [],
  view: ["issue.view"],
  comment: ["issue.view", "issue.comment"],
  manage: ["issue.view", "issue.comment", "issue.manage"],
};

const PROCUREMENT_TIERS: Record<ProcurementTier, readonly ProjectCapability[]> = {
  none: [],
  view: ["procurement.view"],
  comment: ["procurement.view", "procurement.comment"],
  manage: ["procurement.view", "procurement.comment", "procurement.manage"],
};

const FILES_TIERS: Record<FilesTier, readonly ProjectCapability[]> = {
  none: [],
  view: ["files.view"],
  manage: ["files.view", "files.manage"],
};

// Administration caps are independent toggles (not tiered).
const ADMIN_CAPS: readonly ProjectCapability[] = [
  "categories.manage",
  "members.manage",
  "roles.manage",
  "project.manage",
];

// ---------------------------------------------------------------------------
// Derive tier from stored caps
// Picks the highest tier whose full cumulative cap set is fully satisfied.
// For a malformed/non-hierarchical stored combo (e.g. issue.manage without
// issue.view), we pick the highest tier whose identifier cap is present and
// normalize to its cumulative set on next save.
// ---------------------------------------------------------------------------

function deriveIssueTier(caps: readonly ProjectCapability[]): IssueTier {
  if (caps.includes("issue.manage"))
    return "manage";
  if (caps.includes("issue.comment"))
    return "comment";
  if (caps.includes("issue.view"))
    return "view";
  return "none";
}

function deriveProcurementTier(caps: readonly ProjectCapability[]): ProcurementTier {
  if (caps.includes("procurement.manage"))
    return "manage";
  if (caps.includes("procurement.comment"))
    return "comment";
  if (caps.includes("procurement.view"))
    return "view";
  return "none";
}

function deriveFilesTier(caps: readonly ProjectCapability[]): FilesTier {
  if (caps.includes("files.manage"))
    return "manage";
  if (caps.includes("files.view"))
    return "view";
  return "none";
}

// Build the flat capabilities[] from the three module tiers + admin toggles.
function buildCapabilities(
  issueTier: IssueTier,
  procurementTier: ProcurementTier,
  filesTier: FilesTier,
  adminCaps: readonly ProjectCapability[],
): readonly ProjectCapability[] {
  return [
    ...ISSUE_TIERS[issueTier],
    ...PROCUREMENT_TIERS[procurementTier],
    ...FILES_TIERS[filesTier],
    ...adminCaps,
  ];
}

// Preset quick-fill: Reader=all View, Commenter=all Comment + Files View, Writer=all Manage + categories.manage.
const PRESET_READER = { issue: "view" as IssueTier, procurement: "view" as ProcurementTier, files: "view" as FilesTier, admin: [] as ProjectCapability[] };
const PRESET_COMMENTER = { issue: "comment" as IssueTier, procurement: "comment" as ProcurementTier, files: "view" as FilesTier, admin: [] as ProjectCapability[] };
const PRESET_WRITER = { issue: "manage" as IssueTier, procurement: "manage" as ProcurementTier, files: "manage" as FilesTier, admin: ["categories.manage"] as ProjectCapability[] };

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
          <Button onClick={() => setCreateOpen(true)}>
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
                      <span className="font-medium">
                        {role.isSystem
                          ? systemRoleLabel(role, t("roles.owner"), t("roles.guest"))
                          : role.name}
                      </span>
                      {role.isSystem && <Badge variant="outline" className="text-xs">{t("roles.system")}</Badge>}
                    </div>
                    {/* Guest system role: show the fallback explanation. */}
                    {role.isSystem && role.kind === "guest" && (
                      <p className="text-xs text-muted-foreground">{t("roles.guestFallbackNote")}</p>
                    )}
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
                      <Button variant="ghost" onClick={() => setEditTarget(role)}>
                        {t("common:common.edit")}
                      </Button>
                      <Button variant="ghost" onClick={() => setDeleteTarget(role)}>
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

  // Derive initial module tiers and admin caps from the stored flat capabilities[].
  const [issueTier, setIssueTier] = useState<IssueTier>(() => deriveIssueTier(role?.capabilities ?? []));
  const [procurementTier, setProcurementTier] = useState<ProcurementTier>(() => deriveProcurementTier(role?.capabilities ?? []));
  const [filesTier, setFilesTier] = useState<FilesTier>(() => deriveFilesTier(role?.capabilities ?? []));
  const [adminCaps, setAdminCaps] = useState<readonly ProjectCapability[]>(() =>
    (role?.capabilities ?? []).filter(c => ADMIN_CAPS.includes(c)),
  );

  const pending = createRole.isPending || updateRole.isPending;
  const error = createRole.error ?? updateRole.error;

  const toggleAdmin = (cap: ProjectCapability) => {
    setAdminCaps(prev =>
      prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap],
    );
  };

  const applyPreset = (preset: typeof PRESET_READER) => {
    setIssueTier(preset.issue);
    setProcurementTier(preset.procurement);
    setFilesTier(preset.files);
    setAdminCaps(preset.admin);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    const capabilities = buildCapabilities(issueTier, procurementTier, filesTier, adminCaps);
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

          {/* Preset quick-fill buttons: Reader / Commenter / Writer. */}
          <div className="space-y-1.5">
            <Label>{t("roles.presets.label")}</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => applyPreset(PRESET_READER)}>
                {t("roles.presets.reader")}
              </Button>
              <Button type="button" variant="outline" onClick={() => applyPreset(PRESET_COMMENTER)}>
                {t("roles.presets.commenter")}
              </Button>
              <Button type="button" variant="outline" onClick={() => applyPreset(PRESET_WRITER)}>
                {t("roles.presets.writer")}
              </Button>
            </div>
          </div>

          {/* Per-module 3-tier radio selectors */}
          <div className="space-y-2">
            <Label>{t("roles.field.capabilities")}</Label>
            <div className="space-y-4 rounded-md border p-3">

              {/* Issue module */}
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-muted-foreground">
                  {t("capabilityGroup.issue")}
                </legend>
                <RadioGroup
                  value={issueTier}
                  onValueChange={val => setIssueTier(val as IssueTier)}
                  className="flex flex-wrap gap-x-4 gap-y-1"
                >
                  {(["none", "view", "comment", "manage"] as const).map(tier => (
                    <RadioGroupItem key={tier} value={tier}>
                      <span className="text-sm">{t(`roles.tier.${tier}`)}</span>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </fieldset>

              {/* Procurement module */}
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-muted-foreground">
                  {t("capabilityGroup.procurement")}
                </legend>
                <RadioGroup
                  value={procurementTier}
                  onValueChange={val => setProcurementTier(val as ProcurementTier)}
                  className="flex flex-wrap gap-x-4 gap-y-1"
                >
                  {(["none", "view", "comment", "manage"] as const).map(tier => (
                    <RadioGroupItem key={tier} value={tier}>
                      <span className="text-sm">{t(`roles.tier.${tier}`)}</span>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </fieldset>

              {/* Files module — no comment tier */}
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-muted-foreground">
                  {t("capabilityGroup.files")}
                </legend>
                <RadioGroup
                  value={filesTier}
                  onValueChange={val => setFilesTier(val as FilesTier)}
                  className="flex flex-wrap gap-x-4 gap-y-1"
                >
                  {(["none", "view", "manage"] as const).map(tier => (
                    <RadioGroupItem key={tier} value={tier}>
                      <span className="text-sm">{t(`roles.tier.${tier}`)}</span>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </fieldset>

            </div>
          </div>

          {/* Administration caps: independent toggles (not tiered) */}
          <div className="space-y-2">
            <Label>{t("roles.administration")}</Label>
            <div className="space-y-2 rounded-md border p-3">
              {ADMIN_CAPS.map(cap => (
                <div key={cap} className="flex items-center justify-between gap-2">
                  <Label htmlFor={`cap-${cap}`} className="text-sm font-normal">{t(`capability.${cap}` as const)}</Label>
                  <Switch
                    id={`cap-${cap}`}
                    checked={adminCaps.includes(cap)}
                    onCheckedChange={() => toggleAdmin(cap)}
                  />
                </div>
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
