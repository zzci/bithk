// Global procurement categories section of the Project Defaults tab: CRUD over
// the template set copied into every new project on create. Mirrors the per-
// project category UX (-project-settings-categories.tsx) but is not scoped to a
// project.

import type { GlobalCategoryInput, GlobalProcurementCategory } from "@/shared/lib/api/global-categories";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CrudDialog } from "@/shared/components/crud/crud-dialog";
import { CrudListSection } from "@/shared/components/crud/crud-list-section";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { TableCell } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateGlobalCategory,
  useDeleteGlobalCategory,
  useGlobalCategories,
  useUpdateGlobalCategory,
} from "@/shared/lib/api/global-categories";
import { errorMessage } from "@/shared/lib/errors";

export function GlobalCategoriesSection() {
  const { t } = useTranslation(["settings", "common"]);
  const categoriesQuery = useGlobalCategories();
  const deleteCategory = useDeleteGlobalCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GlobalProcurementCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalProcurementCategory | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <CrudListSection
      title={t("settings:projectDefaults.categories.title")}
      description={t("settings:projectDefaults.categories.description")}
      addLabel={t("settings:projectDefaults.categories.create")}
      onAdd={() => setCreateOpen(true)}
      errorMessage={categoriesQuery.error ? errorMessage(categoriesQuery.error, t("common:common.error.loadFailed")) : null}
      columns={[
        { header: t("settings:projectDefaults.categories.colName") },
        { header: t("settings:projectDefaults.categories.colCode") },
        { header: t("settings:projectDefaults.categories.colDescription") },
      ]}
      actionsLabel={t("settings:col.actions")}
      rows={categories}
      emptyLabel={t("settings:projectDefaults.categories.empty")}
      renderRow={category => (
        <>
          <TableCell className="font-medium">{category.name}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{category.code ?? "—"}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{category.description ?? "—"}</TableCell>
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
        title={t("settings:projectDefaults.categories.delete.title")}
        description={t("settings:projectDefaults.categories.delete.confirm", { name: deleteTarget?.name })}
        pending={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = deleteTarget.name;
          deleteCategory.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:projectDefaults.categories.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <CategoryDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <CategoryDialog
          mode="edit"
          category={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </CrudListSection>
  );
}

interface CategoryDialogProps {
  readonly mode: "create" | "edit";
  readonly category?: GlobalProcurementCategory;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CategoryDialog({ mode, category, open, onOpenChange }: CategoryDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createCategory = useCreateGlobalCategory();
  const updateCategory = useUpdateGlobalCategory();

  const [name, setName] = useState(category?.name ?? "");
  const [code, setCode] = useState(category?.code ?? "");
  const [description, setDescription] = useState(category?.description ?? "");

  const pending = createCategory.isPending || updateCategory.isPending;
  const error = createCategory.error ?? updateCategory.error;

  const buildInput = (): GlobalCategoryInput => ({
    code: code.trim() || null,
    description: description.trim() || null,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending)
      return;
    if (mode === "create") {
      createCategory.mutate({ name: trimmed, ...buildInput() }, {
        onSuccess: () => {
          toast.success(t("settings:projectDefaults.categories.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (category) {
      updateCategory.mutate({ id: category.id, name: trimmed, ...buildInput() }, {
        onSuccess: () => {
          toast.success(t("settings:projectDefaults.categories.toast.updated"));
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
      createTitle={t("settings:projectDefaults.categories.createTitle")}
      editTitle={t("settings:projectDefaults.categories.editTitle")}
      description={t("settings:projectDefaults.categories.dialogDescription")}
      errorMessage={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      pending={pending}
      submitDisabled={!name.trim()}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="global-category-name">{t("settings:projectDefaults.categories.fieldName")}</Label>
        <Input id="global-category-name" autoFocus required maxLength={255} value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="global-category-code">{t("settings:projectDefaults.categories.fieldCode")}</Label>
        <Input id="global-category-code" maxLength={100} value={code} onChange={e => setCode(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="global-category-description">{t("settings:projectDefaults.categories.fieldDescription")}</Label>
        <Textarea id="global-category-description" rows={2} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
      </div>
    </CrudDialog>
  );
}
