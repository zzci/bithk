// Procurement categories settings section: CRUD for category name/code/
// description.

import type { CategoryInput, ProcurementCategoryView } from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateProcurementCategory,
  useDeleteProcurementCategory,
  useProcurementCategories,
  useUpdateProcurementCategory,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

interface ProjectSettingsCategoriesProps {
  readonly projectId: string;
  readonly canManage: boolean;
}

export function ProjectSettingsCategories({ projectId, canManage }: ProjectSettingsCategoriesProps) {
  const { t } = useTranslation(["projects", "common"]);
  const categoriesQuery = useProcurementCategories(projectId);
  const deleteCategory = useDeleteProcurementCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProcurementCategoryView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementCategoryView | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("categories.add")}
          </Button>
        </div>
      )}

      {categoriesQuery.error && <ErrorBanner message={errorMessage(categoriesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("categories.col.name")}</TableHead>
              <TableHead>{t("categories.col.code")}</TableHead>
              <TableHead>{t("categories.col.description")}</TableHead>
              {canManage && <TableHead>{t("categories.col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0
              ? <TableRow><TableCell colSpan={canManage ? 4 : 3} className="h-24 text-center text-muted-foreground">{t("categories.empty")}</TableCell></TableRow>
              : categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category.code ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category.description ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditTarget(category)}>
                            {t("common:common.edit")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(category)}>
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
        title={t("categories.delete.title")}
        description={t("categories.delete.confirm", { name: deleteTarget?.name })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteCategory.mutate({ projectId, categoryId: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />

      {canManage && (
        <>
          <CategoryDialog
            projectId={projectId}
            mode="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
          {editTarget && (
            <CategoryDialog
              projectId={projectId}
              mode="edit"
              category={editTarget}
              open
              onOpenChange={open => !open && setEditTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

interface CategoryDialogProps {
  readonly projectId: string;
  readonly mode: "create" | "edit";
  readonly category?: ProcurementCategoryView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CategoryDialog({ projectId, mode, category, open, onOpenChange }: CategoryDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createCategory = useCreateProcurementCategory();
  const updateCategory = useUpdateProcurementCategory();

  const [name, setName] = useState(category?.name ?? "");
  const [code, setCode] = useState(category?.code ?? "");
  const [description, setDescription] = useState(category?.description ?? "");

  const pending = createCategory.isPending || updateCategory.isPending;
  const error = createCategory.error ?? updateCategory.error;

  const buildInput = (): CategoryInput => ({
    code: code.trim() || null,
    description: description.trim() || null,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    if (mode === "create") {
      createCategory.mutate({ projectId, name: name.trim(), ...buildInput() }, {
        onSuccess: () => onOpenChange(false),
      });
    }
    else if (category) {
      updateCategory.mutate({ projectId, categoryId: category.id, name: name.trim(), ...buildInput() }, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("categories.createTitle") : t("categories.editTitle")}</DialogTitle>
            <DialogDescription>{t("categories.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="category-name">{t("categories.field.name")}</Label>
            <Input id="category-name" autoFocus required value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-code">{t("categories.field.code")}</Label>
            <Input id="category-code" value={code} onChange={e => setCode(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-description">{t("categories.field.description")}</Label>
            <Textarea id="category-description" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {mode === "create" ? t("common:common.add") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
