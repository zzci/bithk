// Tag administration section of the Project Defaults tab: list the global tag
// vocabulary with usage counts, create / rename / delete. Deleting cascade-
// unlinks the tag from every project, so the confirm surfaces that impact.

import type { ProjectTag } from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useTags } from "@/shared/lib/api/projects";
import { useCreateTag, useDeleteTag, useRenameTag } from "@/shared/lib/api/tag-admin";
import { errorMessage } from "@/shared/lib/errors";

export function TagAdminSection() {
  const { t } = useTranslation(["settings", "common"]);
  const tagsQuery = useTags();
  const deleteTag = useDeleteTag();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectTag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectTag | null>(null);

  const tags = tagsQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:projectDefaults.tags.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:projectDefaults.tags.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-3" />
          {t("settings:projectDefaults.tags.create")}
        </Button>
      </div>

      {tagsQuery.error && <ErrorBanner message={errorMessage(tagsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:projectDefaults.tags.colName")}</TableHead>
              <TableHead className="w-32">{t("settings:projectDefaults.tags.colUsage")}</TableHead>
              <TableHead className="w-32">{t("settings:col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.length === 0
              ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("settings:projectDefaults.tags.empty")}</TableCell></TableRow>
              : tags.map(tag => (
                  <TableRow key={tag.id}>
                    <TableCell className="font-medium">{tag.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{tag.usageCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" onClick={() => setEditTarget(tag)}>
                          {t("common:common.edit")}
                        </Button>
                        <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(tag)}>
                          {t("common:common.delete")}
                        </Button>
                      </div>
                    </TableCell>
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
        title={t("settings:projectDefaults.tags.delete.title")}
        description={t("settings:projectDefaults.tags.delete.confirm", {
          name: deleteTarget?.name,
          count: deleteTarget?.usageCount ?? 0,
        })}
        pending={deleteTag.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = deleteTarget.name;
          deleteTag.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:projectDefaults.tags.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <TagDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <TagDialog
          mode="edit"
          tag={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </section>
  );
}

interface TagDialogProps {
  readonly mode: "create" | "edit";
  readonly tag?: ProjectTag;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function TagDialog({ mode, tag, open, onOpenChange }: TagDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createTag = useCreateTag();
  const renameTag = useRenameTag();

  const [name, setName] = useState(tag?.name ?? "");
  const pending = createTag.isPending || renameTag.isPending;
  const error = createTag.error ?? renameTag.error;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending)
      return;
    if (mode === "create") {
      createTag.mutate({ name: trimmed }, {
        onSuccess: () => {
          toast.success(t("settings:projectDefaults.tags.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (tag) {
      renameTag.mutate({ id: tag.id, name: trimmed }, {
        onSuccess: () => {
          toast.success(t("settings:projectDefaults.tags.toast.renamed"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("settings:projectDefaults.tags.createTitle") : t("settings:projectDefaults.tags.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:projectDefaults.tags.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="tag-name">{t("settings:projectDefaults.tags.fieldName")}</Label>
            <Input id="tag-name" autoFocus required maxLength={50} value={name} onChange={e => setName(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
