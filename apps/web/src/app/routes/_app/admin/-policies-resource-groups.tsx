import type { ResourceGroup, ResourceGroupMembersResponse, ResourceGroupsResponse } from "./-policies-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { errorMessage } from "@/shared/lib/errors";
import { http } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

export function ResourceGroupManager() {
  const { t } = useTranslation("policies");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<ResourceGroup | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceGroup | null>(null);
  const queryClient = useQueryClient();

  const { data: groupsData, isLoading } = useQuery({
    queryKey: ["resource-groups"],
    queryFn: () => http<ResourceGroupsResponse>("/policy/resource-groups"),
  });

  const deleteMutation = useMutation({
    mutationFn: (group: ResourceGroup) => http(`/policy/resource-groups/${group.id}`, { method: "DELETE" }),
    onSuccess: (_data, group) => {
      queryClient.invalidateQueries({ queryKey: ["resource-groups"] });
      if (selectedId === group.id)
        setSelectedId(null);
      setDeleteConfirm(null);
      toast.success(t("toast.resourceGroupDeleted", { name: group.name }));
    },
    onError: (err) => {
      toast.error(errorMessage(err, t("common.error.deleteFailed", { ns: "common" })));
    },
  });

  const groups = groupsData?.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("resourceGroupList")}</CardTitle>
              <CardDescription>{t("resourceGroupListDescription")}</CardDescription>
            </div>
            <CreateResourceGroupDialog />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading
            ? <p className="text-sm text-muted-foreground">{t("loading")}</p>
            : groups.length === 0
              ? <p className="text-sm text-muted-foreground">{t("noResourceGroups")}</p>
              : (
                  <div className="space-y-1.5">
                    {groups.map((group) => {
                      const active = selectedId === group.id;
                      return (
                        <div
                          key={group.id}
                          className={cn(
                            "group flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors",
                            active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                          )}
                          role="button"
                          tabIndex={0}
                          aria-pressed={active}
                          onClick={() => setSelectedId(group.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(group.id);
                            }
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{group.name}</p>
                            {group.description && (
                              <p className="text-xs text-muted-foreground truncate">{group.description}</p>
                            )}
                          </div>
                          <div
                            className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[active=true]:opacity-100"
                            data-active={active}
                            onClick={e => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("common.edit")}
                              onClick={() => setEditGroup(group)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("common.delete")}
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteConfirm(group)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("resourceGroupMembers")}</CardTitle>
          <CardDescription>{t("resourceGroupMembersDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {selectedId
            ? <ResourceGroupMemberList groupId={selectedId} />
            : <p className="text-sm text-muted-foreground">{t("selectResourceGroup")}</p>}
        </CardContent>
      </Card>

      <EditResourceGroupDialog group={editGroup} onClose={() => setEditGroup(null)} />

      <Dialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteResourceGroupTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteResourceGroupConfirm", { name: deleteConfirm?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditResourceGroupDialog({
  group,
  onClose,
}: {
  readonly group: ResourceGroup | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={group !== null}
      onOpenChange={(open) => {
        if (!open)
          onClose();
      }}
    >
      <DialogContent>
        {group && <EditResourceGroupForm key={group.id} group={group} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditResourceGroupForm({
  group,
  onClose,
}: {
  readonly group: ResourceGroup;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation("policies");
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => http(`/policy/resource-groups/${group.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-groups"] });
      toast.success(t("toast.resourceGroupUpdated", { name: name.trim() }));
      onClose();
    },
    onError: (err) => {
      toast.error(errorMessage(err, t("common.error.saveFailed", { ns: "common" })));
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("editResourceGroupTitle")}</DialogTitle>
        <DialogDescription>{t("editResourceGroupDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>{t("resourceGroupName")}</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("resourceGroupNamePlaceholder")} />
        </div>
        <div className="space-y-2">
          <Label>{t("resourceGroupDescription")}</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t("resourceGroupDescriptionPlaceholder")} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || mutation.isPending}
        >
          {mutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function CreateResourceGroupDialog() {
  const { t } = useTranslation("policies");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => http("/policy/resource-groups", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-groups"] });
      toast.success(t("toast.resourceGroupCreated", { name: name.trim() }));
      setOpen(false);
      setName("");
      setDescription("");
    },
    onError: (err) => {
      toast.error(errorMessage(err, t("common.error.saveFailed", { ns: "common" })));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("createResourceGroup")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createResourceGroupTitle")}</DialogTitle>
          <DialogDescription>{t("createResourceGroupDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("resourceGroupName")}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("resourceGroupNamePlaceholder")} />
          </div>
          <div className="space-y-2">
            <Label>{t("resourceGroupDescription")}</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t("resourceGroupDescriptionPlaceholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? t("creating") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResourceGroupMemberList({ groupId }: { readonly groupId: string }) {
  const { t } = useTranslation("policies");
  const queryClient = useQueryClient();

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["resource-group-members", groupId],
    queryFn: () => http<ResourceGroupMembersResponse>(`/policy/resource-groups/${groupId}/members`),
  });

  const removeMutation = useMutation({
    mutationFn: (tupleId: string) => http(`/policy/resource-groups/${groupId}/members/${tupleId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource-group-members", groupId] });
      toast.success(t("toast.memberRemoved"));
    },
    onError: (err) => {
      toast.error(errorMessage(err, t("common.error.operationFailed", { ns: "common" })));
    },
  });

  const members = membersData?.data ?? [];

  return (
    <div className="space-y-4">
      {isLoading
        ? <p className="text-sm text-muted-foreground">{t("loading")}</p>
        : members.length === 0
          ? <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
          : (
              <div className="space-y-2">
                {members.map(member => (
                  <div key={member.tupleId} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{t(`ns.${member.namespace}`)}</Badge>
                      <span className="text-sm">{member.objectName ?? member.objectId}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeMutation.mutate(member.tupleId)}
                      disabled={removeMutation.isPending}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
    </div>
  );
}
