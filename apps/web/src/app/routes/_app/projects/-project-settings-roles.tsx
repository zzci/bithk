// Roles settings section: an in-page role editor (no nested modal). A Select
// dropdown chooses which role to edit — a "+ New role" entry creates one, every
// existing role loads into the inline editor below. Permissions are set through
// an inline table of per-module tier radios + admin capability toggles.
// System roles (`isSystem`) are read-only and cannot be deleted.

import type { ProjectCapability, ProjectRoleView } from "@/shared/lib/api/projects";
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
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
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

/** Resolve the display label for a system role based on its `kind` field. */

// Sentinel selection value for the "+ New role" (create) entry in the dropdown.
const NEW_ROLE = "__new__";

interface ProjectSettingsRolesProps {
  readonly projectId: string;
  readonly canManage: boolean;
}

export function ProjectSettingsRoles({ projectId, canManage }: ProjectSettingsRolesProps) {
  const { t } = useTranslation(["projects", "common"]);
  const rolesQuery = useProjectRoles(projectId);
  const deleteRole = useDeleteProjectRole();

  // Which role is loaded into the inline editor: NEW_ROLE (create) or a role id.
  const [selectedId, setSelectedId] = useState<string>(canManage ? NEW_ROLE : "");
  // Bumped to force the keyed editor to re-mount (reset its form) after a
  // create/delete even when the effective selection string is unchanged.
  const [resetNonce, setResetNonce] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRoleView | null>(null);

  const roles = rolesQuery.data ?? [];

  // Dropdown options: the create entry (only when the viewer can manage) then
  // every role. The effective selection always resolves to one of these.
  const options = [
    ...(canManage ? [NEW_ROLE] : []),
    ...roles.map(r => r.id),
  ];
  const effectiveId = options.includes(selectedId) ? selectedId : (options[0] ?? "");
  const effectiveRole = roles.find(r => r.id === effectiveId) ?? null;

  const roleOptionLabel = (role: ProjectRoleView) =>
    role.isSystem ? systemRoleLabel(role, t("roles.owner"), t("roles.guest")) : role.name;
  const labelForId = (id: string) => {
    if (id === NEW_ROLE)
      return t("roles.create");
    const role = roles.find(r => r.id === id);
    return role ? roleOptionLabel(role) : id;
  };

  return (
    <div className="space-y-4">
      {rolesQuery.error && <ErrorBanner message={errorMessage(rolesQuery.error, t("common:common.error.loadFailed"))} />}

      {options.length === 0
        ? <p className="text-sm text-muted-foreground">{t("roles.empty")}</p>
        : (
            <>
              <div className="space-y-1.5">
                <Label>{t("roles.selectRole")}</Label>
                <Select value={effectiveId} onValueChange={v => v !== null && setSelectedId(v)}>
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue>
                      {(v: string) => labelForId(v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {canManage && (
                      <SelectItem value={NEW_ROLE}>
                        <Plus className="size-4" />
                        {t("roles.create")}
                      </SelectItem>
                    )}
                    {roles.map(r => (
                      <SelectItem key={r.id} value={r.id}>{roleOptionLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <RoleEditor
                key={`${effectiveId}:${resetNonce}`}
                projectId={projectId}
                role={effectiveRole}
                canManage={canManage}
                onCreated={() => {
                  setSelectedId(NEW_ROLE);
                  setResetNonce(n => n + 1);
                }}
                onRequestDelete={setDeleteTarget}
              />
            </>
          )}

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
              onSuccess: () => {
                toast.success(t("toast.roleDeleted"));
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
  readonly projectId: string;
  // The role loaded into the editor, or null for create mode.
  readonly role: ProjectRoleView | null;
  readonly canManage: boolean;
  readonly onCreated: () => void;
  readonly onRequestDelete: (role: ProjectRoleView) => void;
}

function RoleEditor({ projectId, role, canManage, onCreated, onRequestDelete }: RoleEditorProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createRole = useCreateProjectRole();
  const updateRole = useUpdateProjectRole();

  const isCreate = role === null;
  const isSystem = role?.isSystem ?? false;
  // System roles are capability-locked; viewers without manage rights see
  // everything read-only.
  const editable = canManage && !isSystem;

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
    if (!editable || !name.trim() || pending)
      return;
    const capabilities = buildCapabilities(issueTier, procurementTier, filesTier, adminCaps);
    if (isCreate) {
      createRole.mutate({ projectId, name: name.trim(), capabilities }, {
        onSuccess: () => {
          toast.success(t("toast.roleCreated"));
          onCreated();
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (role) {
      updateRole.mutate({ projectId, roleId: role.id, name: name.trim(), capabilities }, {
        onSuccess: () => toast.success(t("toast.roleUpdated")),
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  let heading: string;
  if (!role)
    heading = t("roles.createTitle");
  else if (role.isSystem)
    heading = systemRoleLabel(role, t("roles.owner"), t("roles.guest"));
  else
    heading = t("roles.editTitle");

  // A single module's tier row: module name + the cumulative tier radios. Plain
  // helper (not a component) so re-renders reconcile in place without remounting.
  const tierRow = (label: string, tiers: readonly string[], value: string, onChange: (v: string) => void) => (
    <TableRow>
      <TableCell className="align-middle font-medium">{label}</TableCell>
      <TableCell>
        <RadioGroup
          value={value}
          onValueChange={v => v !== null && onChange(v)}
          disabled={!editable}
          aria-label={label}
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          {tiers.map(tier => (
            <RadioGroupItem key={tier} value={tier}>
              <span className="text-sm">{t(`roles.tier.${tier}` as const)}</span>
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </TableCell>
    </TableRow>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{heading}</h3>
          {isSystem && <Badge variant="outline" className="text-xs">{t("roles.system")}</Badge>}
        </div>
        {/* Guest system role: show the fallback explanation. */}
        {isSystem && role?.kind === "guest" && (
          <p className="text-xs text-muted-foreground">{t("roles.guestFallbackNote")}</p>
        )}
        {editable && <p className="text-xs text-muted-foreground">{t("roles.dialogDescription")}</p>}
      </div>

      {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

      <div className="space-y-1.5">
        <Label htmlFor="role-name">{t("roles.field.name")}</Label>
        <Input
          id="role-name"
          required={editable}
          disabled={!editable}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      {/* Preset quick-fill buttons: Reader / Commenter / Writer. */}
      {editable && (
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
      )}

      {/* Inline permissions table: per-module tier radios + admin toggles. */}
      <div className="space-y-2">
        <Label>{t("roles.field.capabilities")}</Label>
        <div className="rounded-md border">
          <Table>
            <TableBody>
              {tierRow(t("capabilityGroup.issue"), ["none", "view", "comment", "manage"], issueTier, v => setIssueTier(v as IssueTier))}
              {tierRow(t("capabilityGroup.procurement"), ["none", "view", "comment", "manage"], procurementTier, v => setProcurementTier(v as ProcurementTier))}
              {tierRow(t("capabilityGroup.files"), ["none", "view", "manage"], filesTier, v => setFilesTier(v as FilesTier))}

              {/* Administration caps: independent toggles (not tiered). */}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="bg-muted/50 text-xs font-medium text-muted-foreground">
                  {t("roles.administration")}
                </TableCell>
              </TableRow>
              {ADMIN_CAPS.map(cap => (
                <TableRow key={cap}>
                  <TableCell className="align-middle">
                    <Label htmlFor={`cap-${cap}`} className="font-normal">{t(`capability.${cap}` as const)}</Label>
                  </TableCell>
                  <TableCell>
                    <Switch
                      id={`cap-${cap}`}
                      checked={adminCaps.includes(cap)}
                      onCheckedChange={() => toggleAdmin(cap)}
                      disabled={!editable}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-2">
          {/* Delete is available only for existing custom roles. */}
          {!isCreate && role
            ? (
                <Button type="button" variant="outline" onClick={() => onRequestDelete(role)}>
                  {t("common:common.delete")}
                </Button>
              )
            : <span />}
          <Button type="submit" disabled={pending || !name.trim()}>
            {isCreate ? t("common:common.create") : t("common:common.save")}
          </Button>
        </div>
      )}
    </form>
  );
}
