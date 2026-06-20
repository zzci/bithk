// Global contact-categories vocabulary used to classify contacts. Exposed as a
// reusable section so the "General" settings tab can host it alongside the
// currency category. Mirrors GlobalCategoriesSection but is wired to the
// standalone contact-categories data layer.

import type { ContactCategory, ContactCategoryInput } from "@/shared/lib/api/contact-categories";
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
  useContactCategories,
  useCreateContactCategory,
  useDeleteContactCategory,
  useUpdateContactCategory,
} from "@/shared/lib/api/contact-categories";
import { errorMessage } from "@/shared/lib/errors";

export function ContactCategoriesSection() {
  const { t } = useTranslation(["settings", "common"]);
  const categoriesQuery = useContactCategories();
  const deleteCategory = useDeleteContactCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContactCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactCategory | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <CrudListSection
      title={t("settings:contactCategories.title")}
      description={t("settings:contactCategories.description")}
      addLabel={t("settings:contactCategories.create")}
      onAdd={() => setCreateOpen(true)}
      errorMessage={categoriesQuery.error ? errorMessage(categoriesQuery.error, t("common:common.error.loadFailed")) : null}
      columns={[
        { header: t("settings:contactCategories.colName") },
        { header: t("settings:contactCategories.colCode") },
        { header: t("settings:contactCategories.colDescription") },
      ]}
      actionsLabel={t("settings:col.actions")}
      rows={categories}
      emptyLabel={t("settings:contactCategories.empty")}
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
        title={t("settings:contactCategories.delete.title")}
        description={t("settings:contactCategories.delete.confirm", { name: deleteTarget?.name })}
        pending={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = deleteTarget.name;
          deleteCategory.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:contactCategories.toast.deleted", { name }));
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
  readonly category?: ContactCategory;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CategoryDialog({ mode, category, open, onOpenChange }: CategoryDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createCategory = useCreateContactCategory();
  const updateCategory = useUpdateContactCategory();

  const [name, setName] = useState(category?.name ?? "");
  const [code, setCode] = useState(category?.code ?? "");
  const [description, setDescription] = useState(category?.description ?? "");

  const pending = createCategory.isPending || updateCategory.isPending;
  const error = createCategory.error ?? updateCategory.error;

  const buildInput = (): ContactCategoryInput => ({
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
          toast.success(t("settings:contactCategories.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (category) {
      updateCategory.mutate({ id: category.id, name: trimmed, ...buildInput() }, {
        onSuccess: () => {
          toast.success(t("settings:contactCategories.toast.updated"));
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
      createTitle={t("settings:contactCategories.createTitle")}
      editTitle={t("settings:contactCategories.editTitle")}
      description={t("settings:contactCategories.dialogDescription")}
      errorMessage={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      pending={pending}
      submitDisabled={!name.trim()}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="contact-category-name">{t("settings:contactCategories.fieldName")}</Label>
        <Input id="contact-category-name" autoFocus required maxLength={255} value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-category-code">{t("settings:contactCategories.fieldCode")}</Label>
        <Input id="contact-category-code" maxLength={100} value={code} onChange={e => setCode(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-category-description">{t("settings:contactCategories.fieldDescription")}</Label>
        <Textarea id="contact-category-description" rows={2} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
      </div>
    </CrudDialog>
  );
}
