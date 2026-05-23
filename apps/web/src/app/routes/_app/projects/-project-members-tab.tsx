// Members tab: list project members. pm-only: add (internal user / external),
// edit (role, procurement access, promote external -> internal), remove.

import type { SimpleUser } from "@/shared/lib/api/documents";
import type {
  AddProjectMemberInput,
  ProjectMemberType,
  ProjectMemberView,
  ProjectRole,
  UpdateProjectMemberInput,
} from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  useAddProjectMember,
  useRemoveProjectMember,
  useUpdateProjectMember,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { memberLabel } from "./-member-helpers";

interface ProjectMembersTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  readonly canManage: boolean;
}

export function ProjectMembersTab({ projectId, members, userNames, canManage }: ProjectMembersTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const removeMember = useRemoveProjectMember();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectMemberView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMemberView | null>(null);

  const existingUserIds = useMemo(
    () => new Set(members.map(m => m.userId).filter((id): id is string => id !== null)),
    [members],
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("members.add")}
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("members.col.member")}</TableHead>
              <TableHead>{t("members.col.type")}</TableHead>
              <TableHead>{t("members.col.role")}</TableHead>
              <TableHead>{t("members.col.procurement")}</TableHead>
              {canManage && <TableHead>{t("members.col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0
              ? <TableRow><TableCell colSpan={canManage ? 5 : 4} className="h-24 text-center text-muted-foreground">{t("members.empty")}</TableCell></TableRow>
              : members.map(member => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{memberLabel(member, userNames)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{t(`members.type.${member.memberType}` as const)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t(`members.role.${member.role}` as const)}</TableCell>
                    <TableCell className="text-sm">
                      {member.canViewProcurement ? t("members.yes") : t("members.no")}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditTarget(member)}>
                            {t("common:common.edit")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(member)}>
                            {t("common:common.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("members.delete.title")}
        description={t("members.delete.confirm")}
        onConfirm={() => {
          if (deleteTarget) {
            removeMember.mutate({ projectId, memberId: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />

      {canManage && (
        <>
          <AddMemberDialog
            projectId={projectId}
            open={addOpen}
            onOpenChange={setAddOpen}
            existingUserIds={existingUserIds}
          />
          {editTarget && (
            <EditMemberDialog
              projectId={projectId}
              member={editTarget}
              open
              onOpenChange={open => !open && setEditTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

interface AddMemberDialogProps {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly existingUserIds: ReadonlySet<string>;
}

function AddMemberDialog({ projectId, open, onOpenChange, existingUserIds }: AddMemberDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const addMember = useAddProjectMember();
  const usersQuery = useVisibleUsers();

  const [memberType, setMemberType] = useState<ProjectMemberType>("internal");
  const [role, setRole] = useState<ProjectRole>("member");
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [supplierInfo, setSupplierInfo] = useState("");
  const [canViewProcurement, setCanViewProcurement] = useState(false);

  const availableUsers = useMemo<readonly SimpleUser[]>(
    () => (usersQuery.data ?? []).filter(u => !existingUserIds.has(u.id)),
    [usersQuery.data, existingUserIds],
  );

  const reset = () => {
    setMemberType("internal");
    setRole("member");
    setUserId("");
    setDisplayName("");
    setExternalRef("");
    setSupplierInfo("");
    setCanViewProcurement(false);
  };

  const valid = memberType === "internal" ? !!userId : !!displayName.trim();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || addMember.isPending)
      return;
    const body: AddProjectMemberInput = memberType === "internal"
      ? { memberType, role, userId, canViewProcurement }
      : {
          memberType,
          role,
          displayName: displayName.trim(),
          canViewProcurement,
          ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
          ...(supplierInfo.trim() ? { supplierInfo: supplierInfo.trim() } : {}),
        };
    addMember.mutate({ projectId, ...body }, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("members.addTitle")}</DialogTitle>
            <DialogDescription>{t("members.addDescription")}</DialogDescription>
          </DialogHeader>

          {addMember.error && <ErrorBanner message={errorMessage(addMember.error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label>{t("members.field.memberType")}</Label>
            <Select value={memberType} onValueChange={v => v !== null && setMemberType(v as ProjectMemberType)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => t(`members.type.${v}` as const)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">{t("members.type.internal")}</SelectItem>
                <SelectItem value="external">{t("members.type.external")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {memberType === "internal"
            ? (
                <div className="space-y-1.5">
                  <Label>{t("members.field.user")}</Label>
                  <Select value={userId} onValueChange={v => v !== null && setUserId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("members.selectUser")}>
                        {(v: string) => availableUsers.find(u => u.id === v)?.name ?? v}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {availableUsers.map(u => (
                        <SelectItem key={u.id} value={u.id}>{`${u.name} (${u.username})`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="member-display">{t("members.field.displayName")}</Label>
                    <Input id="member-display" required value={displayName} onChange={e => setDisplayName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="member-ref">{t("members.field.externalRef")}</Label>
                    <Input id="member-ref" value={externalRef} onChange={e => setExternalRef(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="member-supplier">{t("members.field.supplierInfo")}</Label>
                    <Input id="member-supplier" value={supplierInfo} onChange={e => setSupplierInfo(e.target.value)} />
                  </div>
                </>
              )}

          <div className="space-y-1.5">
            <Label>{t("members.field.role")}</Label>
            <Select value={role} onValueChange={v => v !== null && setRole(v as ProjectRole)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => t(`members.role.${v}` as const)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("members.role.member")}</SelectItem>
                <SelectItem value="pm">{t("members.role.pm")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="member-procurement">{t("members.field.canViewProcurement")}</Label>
            <Switch id="member-procurement" checked={canViewProcurement} onCheckedChange={setCanViewProcurement} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={addMember.isPending || !valid}>
              {t("common:common.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditMemberDialogProps {
  readonly projectId: string;
  readonly member: ProjectMemberView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function EditMemberDialog({ projectId, member, open, onOpenChange }: EditMemberDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const updateMember = useUpdateProjectMember();
  const usersQuery = useVisibleUsers();

  const [role, setRole] = useState<ProjectRole>(member.role);
  const [canViewProcurement, setCanViewProcurement] = useState(member.canViewProcurement);
  const [displayName, setDisplayName] = useState(member.displayName ?? "");
  const [externalRef, setExternalRef] = useState(member.externalRef ?? "");
  const [supplierInfo, setSupplierInfo] = useState(member.supplierInfo ?? "");
  // Promotion: external -> internal by assigning a user id.
  const [promoteUserId, setPromoteUserId] = useState("");

  const isExternal = member.memberType === "external";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (updateMember.isPending)
      return;
    const body: UpdateProjectMemberInput = {
      role,
      canViewProcurement,
      ...(isExternal
        ? {
            displayName: displayName.trim(),
            externalRef: externalRef.trim(),
            supplierInfo: supplierInfo.trim(),
            ...(promoteUserId ? { userId: promoteUserId, memberType: "internal" as const } : {}),
          }
        : {}),
    };
    updateMember.mutate({ projectId, memberId: member.id, ...body }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("members.editTitle")}</DialogTitle>
            <DialogDescription>{t("members.editDescription")}</DialogDescription>
          </DialogHeader>

          {updateMember.error && <ErrorBanner message={errorMessage(updateMember.error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label>{t("members.field.role")}</Label>
            <Select value={role} onValueChange={v => v !== null && setRole(v as ProjectRole)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => t(`members.role.${v}` as const)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("members.role.member")}</SelectItem>
                <SelectItem value="pm">{t("members.role.pm")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isExternal && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-display">{t("members.field.displayName")}</Label>
                <Input id="edit-display" value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-ref">{t("members.field.externalRef")}</Label>
                <Input id="edit-ref" value={externalRef} onChange={e => setExternalRef(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-supplier">{t("members.field.supplierInfo")}</Label>
                <Input id="edit-supplier" value={supplierInfo} onChange={e => setSupplierInfo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("members.promote")}</Label>
                <Select value={promoteUserId} onValueChange={v => v !== null && setPromoteUserId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("members.selectUser")}>
                      {(v: string) => (usersQuery.data ?? []).find(u => u.id === v)?.name ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(usersQuery.data ?? []).map(u => (
                      <SelectItem key={u.id} value={u.id}>{`${u.name} (${u.username})`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex items-center justify-between">
            <Label htmlFor="edit-procurement">{t("members.field.canViewProcurement")}</Label>
            <Switch id="edit-procurement" checked={canViewProcurement} onCheckedChange={setCanViewProcurement} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={updateMember.isPending}>
              {t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
