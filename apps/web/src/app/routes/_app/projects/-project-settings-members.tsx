// Members settings section: add real (user) or virtual (displayName) members,
// assign a role from the project's role set, set an optional title, edit
// (including promoting a virtual member by assigning a userId), and remove.

import type { SimpleUser } from "@/shared/lib/api/documents";
import type {
  AddProjectMemberInput,
  ProjectMemberView,
  ProjectRoleView,
  UpdateProjectMemberInput,
} from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
  useProjectRoles,
  useRemoveProjectMember,
  useUpdateProjectMember,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { memberLabel } from "./-member-helpers";

type MemberKind = "real" | "virtual";

interface ProjectSettingsMembersProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  readonly canManage: boolean;
}

export function ProjectSettingsMembers({ projectId, members, userNames, canManage }: ProjectSettingsMembersProps) {
  const { t } = useTranslation(["projects", "common"]);
  const rolesQuery = useProjectRoles(projectId);
  const removeMember = useRemoveProjectMember();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectMemberView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMemberView | null>(null);

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const roleNames = useMemo(
    () => new Map(roles.map(r => [r.id, r.name])),
    [roles],
  );

  const existingUserIds = useMemo(
    () => new Set(members.map(m => m.userId).filter((id): id is string => id !== null)),
    [members],
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
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
              <TableHead>{t("members.col.title")}</TableHead>
              <TableHead>{t("members.col.role")}</TableHead>
              {canManage && <TableHead>{t("members.col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0
              ? <TableRow><TableCell colSpan={canManage ? 4 : 3} className="h-24 text-center text-muted-foreground">{t("members.empty")}</TableCell></TableRow>
              : members.map(member => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {memberLabel(member, userNames)}
                        {member.userId === null && (
                          <Badge variant="outline" className="text-xs">{t("members.virtual")}</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{member.title ?? "—"}</TableCell>
                    <TableCell className="text-sm">{roleNames.get(member.roleId) ?? member.roleId}</TableCell>
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
            removeMember.mutate({ projectId, memberId: deleteTarget.id }, {
              onSuccess: () => toast.success(t("toast.memberRemoved")),
              onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
            });
            setDeleteTarget(null);
          }
        }}
      />

      {canManage && (
        <>
          <AddMemberDialog
            projectId={projectId}
            roles={roles}
            open={addOpen}
            onOpenChange={setAddOpen}
            existingUserIds={existingUserIds}
          />
          {editTarget && (
            <EditMemberDialog
              projectId={projectId}
              member={editTarget}
              roles={roles}
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
  readonly roles: readonly ProjectRoleView[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly existingUserIds: ReadonlySet<string>;
}

function AddMemberDialog({ projectId, roles, open, onOpenChange, existingUserIds }: AddMemberDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const addMember = useAddProjectMember();
  const usersQuery = useVisibleUsers();

  const [kind, setKind] = useState<MemberKind>("real");
  const [roleId, setRoleId] = useState("");
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");

  const availableUsers = useMemo<readonly SimpleUser[]>(
    () => (usersQuery.data ?? []).filter(u => !existingUserIds.has(u.id)),
    [usersQuery.data, existingUserIds],
  );

  const reset = () => {
    setKind("real");
    setRoleId("");
    setUserId("");
    setDisplayName("");
    setTitle("");
  };

  const valid = !!roleId && (kind === "real" ? !!userId : !!displayName.trim());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || addMember.isPending)
      return;
    const body: AddProjectMemberInput = kind === "real"
      ? { roleId, userId, ...(title.trim() ? { title: title.trim() } : {}) }
      : { roleId, displayName: displayName.trim(), ...(title.trim() ? { title: title.trim() } : {}) };
    addMember.mutate({ projectId, ...body }, {
      onSuccess: () => {
        toast.success(t("toast.memberAdded"));
        reset();
        onOpenChange(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
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
            <Label>{t("members.field.kind")}</Label>
            <Select value={kind} onValueChange={v => v !== null && setKind(v as MemberKind)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => t(`members.kind.${v}` as const)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="real">{t("members.kind.real")}</SelectItem>
                <SelectItem value="virtual">{t("members.kind.virtual")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "real"
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
                <div className="space-y-1.5">
                  <Label htmlFor="member-display">{t("members.field.displayName")}</Label>
                  <Input id="member-display" required value={displayName} onChange={e => setDisplayName(e.target.value)} />
                </div>
              )}

          <div className="space-y-1.5">
            <Label htmlFor="member-title">{t("members.field.title")}</Label>
            <Input id="member-title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <RoleSelect roles={roles} value={roleId} onChange={setRoleId} />

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
  readonly roles: readonly ProjectRoleView[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function EditMemberDialog({ projectId, member, roles, open, onOpenChange }: EditMemberDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const updateMember = useUpdateProjectMember();
  const usersQuery = useVisibleUsers();

  const [roleId, setRoleId] = useState(member.roleId);
  const [title, setTitle] = useState(member.title ?? "");
  const [displayName, setDisplayName] = useState(member.displayName ?? "");
  // Promotion: virtual -> real by assigning a user id.
  const [promoteUserId, setPromoteUserId] = useState("");

  const isVirtual = member.userId === null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (updateMember.isPending)
      return;
    const body: UpdateProjectMemberInput = {
      roleId,
      title: title.trim() || null,
      ...(isVirtual
        ? {
            displayName: displayName.trim() || null,
            ...(promoteUserId ? { userId: promoteUserId } : {}),
          }
        : {}),
    };
    updateMember.mutate({ projectId, memberId: member.id, ...body }, {
      onSuccess: () => {
        toast.success(t("toast.memberUpdated"));
        onOpenChange(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
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

          <RoleSelect roles={roles} value={roleId} onChange={setRoleId} />

          <div className="space-y-1.5">
            <Label htmlFor="edit-title">{t("members.field.title")}</Label>
            <Input id="edit-title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          {isVirtual && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-display">{t("members.field.displayName")}</Label>
                <Input id="edit-display" value={displayName} onChange={e => setDisplayName(e.target.value)} />
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

interface RoleSelectProps {
  readonly roles: readonly ProjectRoleView[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function RoleSelect({ roles, value, onChange }: RoleSelectProps) {
  const { t } = useTranslation("projects");
  return (
    <div className="space-y-1.5">
      <Label>{t("members.field.role")}</Label>
      <Select value={value} onValueChange={v => v !== null && onChange(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("members.selectRole")}>
            {(v: string) => roles.find(r => r.id === v)?.name ?? v}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {roles.map(r => (
            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
