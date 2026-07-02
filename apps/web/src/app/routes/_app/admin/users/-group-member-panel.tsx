// Member panel card for the admin groups tab, extracted from groups.lazy.tsx:
// header (selection-aware title + add-member dialog with debounced user search)
// and the member list with remove/demote actions. Pure presentation — all data
// and mutations stay in the tab and arrive via props.

import type { AccountGroupMember, AccountUser } from "@/shared/lib/api/account";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

interface GroupMemberPanelProps {
  readonly selectedId: string | null;
  readonly selectionLabel: string | null;
  readonly isAdminsSelected: boolean;
  readonly isDefaultSelected: boolean;
  readonly members: readonly AccountGroupMember[];
  readonly membersLoading: boolean;
  /** The signed-in admin cannot demote itself (self-PATCH is forbidden server-side). */
  readonly currentUserId: string | undefined;
  readonly addMemberOpen: boolean;
  readonly onAddMemberOpenChange: (open: boolean) => void;
  readonly userSearch: string;
  readonly onUserSearchChange: (q: string) => void;
  /** Debounced search results, already filtered for the current selection. */
  readonly candidates: readonly AccountUser[];
  readonly onAddMember: (userId: string) => void;
  readonly onRemoveMember: (userId: string) => void;
}

export function GroupMemberPanel({
  selectedId,
  selectionLabel,
  isAdminsSelected,
  isDefaultSelected,
  members,
  membersLoading,
  currentUserId,
  addMemberOpen,
  onAddMemberOpenChange,
  userSearch,
  onUserSearchChange,
  candidates,
  onAddMember,
  onRemoveMember,
}: GroupMemberPanelProps) {
  const { t } = useTranslation("groups");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate">
              {selectionLabel ? t("membersOf", { name: selectionLabel }) : t("membersTitle")}
            </CardTitle>
            <CardDescription>
              {isAdminsSelected ? t("admins.membersDescription") : isDefaultSelected ? t("default.membersDescription") : t("membersDescription")}
            </CardDescription>
          </div>
          {selectedId !== null && !isDefaultSelected && (
            <Dialog open={addMemberOpen} onOpenChange={onAddMemberOpenChange}>
              <DialogTrigger render={(
                <Button>
                  <UserPlus className="mr-1 size-4" />
                  {t("createMember")}
                </Button>
              )}
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("createMemberTitle")}</DialogTitle>
                  <DialogDescription>
                    {isAdminsSelected ? t("admins.addDescription") : t("createMemberDescription")}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <Input
                    placeholder={t("searchUserPlaceholder")}
                    value={userSearch}
                    onChange={e => onUserSearchChange(e.target.value)}
                  />
                  {candidates.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-md border">
                      {candidates.map(u => (
                        <Button
                          key={u.id}
                          type="button"
                          variant="ghost"
                          className="h-auto w-full justify-between rounded-none px-3 py-2 text-left text-sm font-normal transition-colors hover:bg-muted"
                          onClick={() => onAddMember(u.id)}
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
          ? <p className="text-sm text-muted-foreground">{t("selectGroup")}</p>
          : isDefaultSelected
            ? <p className="text-sm text-muted-foreground">{t("default.membersDescription")}</p>
            : membersLoading
              ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              : members.length === 0
                ? <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
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
                          {/* The caller cannot demote itself (self-PATCH is
                            forbidden server-side). */}
                          {!(isAdminsSelected && member.id === currentUserId) && (
                            <Button
                              variant="ghost"
                              onClick={() => onRemoveMember(member.id)}
                              className="shrink-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="mr-1 size-3.5" />
                              {t("removeMember")}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
      </CardContent>
    </Card>
  );
}
