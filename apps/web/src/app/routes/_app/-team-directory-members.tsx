// Team directory members panel: lists members with their role, lets an admin
// add a visible user, change a member's role, or remove them. All mutating
// actions are gated on the requesting user's effective role (returned by the
// team-directory view) — non-admins see a read-only roster.

import type { TeamDirectoryRole } from "@/shared/lib/api/drive";
import { Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  useAddMember,
  useDirectoryMembers,
  useRemoveMember,
  useTeamDirectory,
  useUpdateMember,
} from "@/shared/lib/api/drive";
import { displayName } from "@/shared/lib/users";

const ROLES: readonly TeamDirectoryRole[] = ["admin", "editor", "viewer"];

interface MembersPanelProps {
  readonly directoryId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function TeamDirectoryMembersPanel({ directoryId, open, onOpenChange }: MembersPanelProps) {
  const { t } = useTranslation(["drive", "common"]);
  const directory = useTeamDirectory(open ? directoryId : undefined);
  const membersQuery = useDirectoryMembers(open ? directoryId : undefined);
  const usersQuery = useVisibleUsers();
  const addMember = useAddMember();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();

  const isAdmin = directory.data?.role === "admin";
  const members = membersQuery.data ?? [];
  const userMap = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u])),
    [usersQuery.data],
  );

  const [newUserId, setNewUserId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<TeamDirectoryRole>("viewer");

  const memberIds = new Set(members.map(m => m.userId));
  const candidates = (usersQuery.data ?? []).filter(u => !memberIds.has(u.id));

  const add = () => {
    if (!newUserId)
      return;
    addMember.mutate(
      { directoryId, userId: newUserId, role: newRole },
      { onSuccess: () => setNewUserId(null) },
    );
  };

  const error = membersQuery.error ?? addMember.error ?? updateMember.error ?? removeMember.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("drive:team.members.title", { name: directory.data?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("drive:team.members.description")}</DialogDescription>
        </DialogHeader>

        {isAdmin && (
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="member-user">{t("drive:team.members.addUser")}</Label>
              <Select value={newUserId ?? ""} onValueChange={v => setNewUserId(v || null)}>
                <SelectTrigger id="member-user" className="w-full">
                  <SelectValue placeholder={t("team.members.userPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map(u => (
                    <SelectItem key={u.id} value={u.id}>{`${u.name} (${u.username})`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="member-role">{t("drive:team.members.role")}</Label>
              <RoleSelect value={newRole} onChange={setNewRole} />
            </div>
            <Button type="button" className="justify-self-end" disabled={!newUserId || addMember.isPending} onClick={add}>
              <UserPlus className="size-4" />
              {addMember.isPending ? t("common:common.submitting") : t("drive:team.members.add")}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error.message}</p>}

        <ul className="grid gap-1">
          {membersQuery.isLoading && <li className="py-4 text-center text-sm text-muted-foreground">{t("common:common.loading")}</li>}
          {!membersQuery.isLoading && members.length === 0 && (
            <li className="py-4 text-center text-sm text-muted-foreground">{t("drive:team.members.empty")}</li>
          )}
          {members.map(member => (
            <li key={member.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate">{displayName(userMap, member.userId)}</span>
              {isAdmin
                ? (
                    <RoleSelect
                      value={member.role}
                      disabled={updateMember.isPending}
                      onChange={role => updateMember.mutate({ directoryId, memberId: member.id, role })}
                    />
                  )
                : <Badge variant="secondary">{t(`drive:team.role.${member.role}`)}</Badge>}
              {isAdmin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={t("drive:team.members.remove")}
                  disabled={removeMember.isPending}
                  onClick={() => removeMember.mutate({ directoryId, memberId: member.id })}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect({ value, onChange, disabled }: {
  readonly value: TeamDirectoryRole;
  readonly onChange: (value: TeamDirectoryRole) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation("drive");
  return (
    <Select value={value} onValueChange={v => v && onChange(v as TeamDirectoryRole)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map(r => (
          <SelectItem key={r} value={r}>{t(`team.role.${r}`)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
