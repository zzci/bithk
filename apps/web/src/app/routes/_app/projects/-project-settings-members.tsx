// Members settings section: add a member by selecting a unified user (real or
// virtual) from the assignable-users list, assign a role from the project's
// role set, set an optional title, edit (role + title), and remove.

import type {
  AddProjectMemberInput,
  AssignableUser,
  ProjectMemberView,
  ProjectRoleView,
  UpdateProjectMemberInput,
} from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
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
  useAssignableUsers,
  useProjectRoles,
  useRemoveProjectMember,
  useUpdateProjectMember,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { memberLabel, systemRoleLabel } from "./-member-helpers";

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
  // System roles resolve their label by kind (owner -> "Project Owner",
  // guest -> "Guest"); custom roles keep their stored name.
  const roleNames = useMemo(
    () => new Map(roles.map(r => [r.id, r.isSystem ? systemRoleLabel(r, t("roles.owner"), t("roles.guest")) : r.name])),
    [roles, t],
  );

  const existingUserIds = useMemo(
    () => new Set(members.map(m => m.userId)),
    [members],
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("members.create")}
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
                        {member.isVirtual && (
                          <Badge variant="outline" className="text-xs">{t("members.virtual")}</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{member.title ?? "—"}</TableCell>
                    <TableCell className="text-sm">{roleNames.get(member.roleId) ?? member.roleId}</TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => setEditTarget(member)}>
                            {t("common:common.edit")}
                          </Button>
                          <Button variant="ghost" onClick={() => setDeleteTarget(member)}>
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
  const usersQuery = useAssignableUsers();

  const [roleId, setRoleId] = useState("");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");

  // Candidate users: unified real + virtual, minus those already a member.
  const availableUsers = useMemo<readonly AssignableUser[]>(
    () => (usersQuery.data ?? []).filter(u => !existingUserIds.has(u.id)),
    [usersQuery.data, existingUserIds],
  );

  const reset = () => {
    setRoleId("");
    setUserId("");
    setTitle("");
  };

  const valid = !!roleId && !!userId;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || addMember.isPending)
      return;
    const body: AddProjectMemberInput = {
      roleId,
      userId,
      ...(title.trim() ? { title: title.trim() } : {}),
    };
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
            <DialogTitle>{t("members.createTitle")}</DialogTitle>
            <DialogDescription>{t("members.createDescription")}</DialogDescription>
          </DialogHeader>

          {addMember.error && <ErrorBanner message={errorMessage(addMember.error, t("common:common.error.operationFailed"))} />}

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
                  <SelectItem key={u.id} value={u.id}>
                    <span className="flex items-center gap-2">
                      {`${u.name} (${u.username})`}
                      {u.isVirtual && (
                        <Badge variant="outline" className="text-xs">{t("members.virtual")}</Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              {t("common:common.create")}
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

  const [roleId, setRoleId] = useState(member.roleId);
  const [title, setTitle] = useState(member.title ?? "");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (updateMember.isPending)
      return;
    const body: UpdateProjectMemberInput = {
      roleId,
      title: title.trim() || null,
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
  // System roles resolve their label by kind; custom roles keep their name.
  const roleLabel = (role: ProjectRoleView | undefined) =>
    role ? (role.isSystem ? systemRoleLabel(role, t("roles.owner"), t("roles.guest")) : role.name) : value;
  // The Guest system role is not directly assignable, so exclude it from the
  // options. The trigger label still resolves against the full `roles` list so
  // a member already on the guest role displays correctly.
  const assignableRoles = roles.filter(r => r.kind !== "guest");
  return (
    <div className="space-y-1.5">
      <Label>{t("members.field.role")}</Label>
      <Select value={value} onValueChange={v => v !== null && onChange(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("members.selectRole")}>
            {(v: string) => roleLabel(roles.find(r => r.id === v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {assignableRoles.map(r => (
            <SelectItem key={r.id} value={r.id}>{roleLabel(r)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
