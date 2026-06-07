// Tag administration section of the Project Defaults tab: list the global tag
// vocabulary with usage counts, create / rename / delete. Deleting cascade-
// unlinks the tag from every project, so the confirm surfaces that impact.

import type { ProjectTag } from "@/shared/lib/api/projects";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CrudDialog } from "@/shared/components/crud/crud-dialog";
import { CrudListSection } from "@/shared/components/crud/crud-list-section";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { TableCell } from "@/shared/components/ui/table";
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
    <CrudListSection
      title={t("settings:projectDefaults.tags.title")}
      description={t("settings:projectDefaults.tags.description")}
      addLabel={t("settings:projectDefaults.tags.create")}
      onAdd={() => setCreateOpen(true)}
      errorMessage={tagsQuery.error ? errorMessage(tagsQuery.error, t("common:common.error.loadFailed")) : null}
      columns={[
        { header: t("settings:projectDefaults.tags.colName") },
        { header: t("settings:projectDefaults.tags.colUsage"), className: "w-32" },
      ]}
      actionsLabel={t("settings:col.actions")}
      rows={tags}
      emptyLabel={t("settings:projectDefaults.tags.empty")}
      renderRow={tag => (
        <>
          <TableCell className="font-medium">{tag.name}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{tag.usageCount}</TableCell>
        </>
      )}
      editLabel={t("common:common.edit")}
      deleteLabel={t("common:common.delete")}
      onEdit={setEditTarget}
      onDelete={setDeleteTarget}
    >
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
    </CrudListSection>
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
    <CrudDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      createTitle={t("settings:projectDefaults.tags.createTitle")}
      editTitle={t("settings:projectDefaults.tags.editTitle")}
      description={t("settings:projectDefaults.tags.dialogDescription")}
      errorMessage={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      pending={pending}
      submitDisabled={!name.trim()}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="tag-name">{t("settings:projectDefaults.tags.fieldName")}</Label>
        <Input id="tag-name" autoFocus required maxLength={50} value={name} onChange={e => setName(e.target.value)} />
      </div>
    </CrudDialog>
  );
}
