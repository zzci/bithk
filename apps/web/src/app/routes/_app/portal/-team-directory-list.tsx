// Team directory list: browse the team directories the user belongs to,
// create new ones, rename/delete those they administer, open a directory's
// file browser (via `onOpenDirectory`, wired by the drive page), and manage
// each directory's members. Admin-only actions are gated on the effective
// role returned per directory.

import type { FormEvent } from "react";
import type { TeamDirectory } from "@/shared/lib/api/drive";
import { FolderCog, FolderPlus, Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateTeamDirectory,
  useDeleteTeamDirectory,
  useTeamDirectories,
  useUpdateTeamDirectory,
} from "@/shared/lib/api/drive";

import { TeamDirectoryMembersPanel } from "./-team-directory-members";

interface TeamDirectoryListProps {
  readonly onOpenDirectory?: (directory: TeamDirectory) => void;
}

type EditState
  = | { readonly type: "create" }
    | { readonly type: "rename"; readonly directory: TeamDirectory }
    | null;

export function TeamDirectoryList({ onOpenDirectory }: TeamDirectoryListProps) {
  const { t } = useTranslation(["drive", "common"]);
  const query = useTeamDirectories();
  const deleteDirectory = useDeleteTeamDirectory();

  const [edit, setEdit] = useState<EditState>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamDirectory | null>(null);

  const directories = query.data ?? [];

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("drive:team.list.title")}</p>
        <Button type="button" size="sm" onClick={() => setEdit({ type: "create" })}>
          <FolderPlus className="size-4" />
          {t("drive:team.list.create")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("drive:team.col.name")}</TableHead>
            <TableHead className="hidden w-24 md:table-cell">{t("drive:team.col.members")}</TableHead>
            <TableHead className="w-24">{t("drive:team.col.role")}</TableHead>
            <TableHead className="w-28 text-right">{t("drive:team.col.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && (
            <TableRow>
              <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">{t("common:common.loading")}</TableCell>
            </TableRow>
          )}
          {query.error && (
            <TableRow>
              <TableCell colSpan={4} className="h-20 text-center text-destructive">{query.error.message}</TableCell>
            </TableRow>
          )}
          {!query.isLoading && !query.error && directories.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">{t("drive:team.empty")}</TableCell>
            </TableRow>
          )}
          {directories.map(directory => (
            <TableRow key={directory.id}>
              <TableCell className="min-w-0">
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 rounded text-left hover:text-foreground disabled:cursor-default"
                  disabled={!onOpenDirectory}
                  onClick={() => onOpenDirectory?.(directory)}
                >
                  <FolderCog className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{directory.name}</span>
                </button>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{directory.memberCount}</TableCell>
              <TableCell>
                <Badge variant="secondary">{t(`drive:team.role.${directory.role}`)}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <ManageMembersButton directory={directory} />
                  {directory.role === "admin" && (
                    <>
                      <Button type="button" variant="ghost" size="icon-sm" title={t("drive:team.action.rename")} onClick={() => setEdit({ type: "rename", directory })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" title={t("drive:team.action.delete")} onClick={() => setDeleteTarget(directory)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <DirectoryEditDialog state={edit} onClose={() => setEdit(null)} />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={t("drive:team.delete.title")}
        description={t("drive:team.delete.description", { name: deleteTarget?.name ?? "" })}
        pending={deleteDirectory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          deleteDirectory.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}

/** Opens the members panel for a directory. Exported for reuse by the drive page. */
export function ManageMembersButton({ directory }: { readonly directory: TeamDirectory }) {
  const { t } = useTranslation("drive");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="icon-sm" title={t("team.action.members")} onClick={() => setOpen(true)}>
        <Users className="size-4" />
      </Button>
      <TeamDirectoryMembersPanel directoryId={directory.id} open={open} onOpenChange={setOpen} />
    </>
  );
}

function DirectoryEditDialog({ state, onClose }: {
  readonly state: EditState;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["drive", "common"]);
  const createDirectory = useCreateTeamDirectory();
  const updateDirectory = useUpdateTeamDirectory();
  const isRename = state?.type === "rename";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Seed fields whenever a new dialog target opens.
  const target = state?.type === "rename" ? state.directory : null;
  const [seededId, setSeededId] = useState<string | null>(null);
  const currentId = target?.id ?? (state?.type === "create" ? "__create__" : null);
  if (currentId !== seededId) {
    setSeededId(currentId);
    setName(target?.name ?? "");
    setDescription(target?.description ?? "");
  }

  const pending = createDirectory.isPending || updateDirectory.isPending;
  const error = createDirectory.error ?? updateDirectory.error;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed)
      return;
    const payload = { name: trimmed, description: description.trim() || null };
    if (state?.type === "rename") {
      updateDirectory.mutate({ id: state.directory.id, ...payload }, { onSuccess: onClose });
    }
    else {
      createDirectory.mutate(payload, { onSuccess: onClose });
    }
  };

  return (
    <Dialog open={state !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isRename ? t("drive:team.edit.renameTitle") : t("drive:team.edit.createTitle")}</DialogTitle>
            <DialogDescription>{isRename ? t("drive:team.edit.renameDescription") : t("drive:team.edit.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="team-dir-name">{t("drive:team.col.name")}</Label>
            <Input id="team-dir-name" autoFocus value={name} onChange={e => setName(e.currentTarget.value)} placeholder={t("drive:team.edit.namePlaceholder")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="team-dir-desc">{t("drive:team.edit.description")}</Label>
            <Textarea id="team-dir-desc" value={description} onChange={e => setDescription(e.currentTarget.value)} placeholder={t("drive:team.edit.descriptionPlaceholder")} />
          </div>
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common:common.cancel")}</Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? t("common:common.saving") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
