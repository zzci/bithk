// Body of the admin "Ship" settings tab. Hosts the global worklist-categories
// vocabulary that seeds the worklist form's free-text category field as
// suggestions. Mirrors ContactSettingsTab but is wired to the standalone
// worklist-categories data layer (no `code` column). Structured as a container
// so future ship-scoped settings sections can be added alongside.

import type { WorklistCategory, WorklistCategoryInput } from "@/shared/lib/api/worklist-categories";
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
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateWorklistCategory,
  useDeleteWorklistCategory,
  useUpdateWorklistCategory,
  useWorklistCategories,
} from "@/shared/lib/api/worklist-categories";
import { errorMessage } from "@/shared/lib/errors";

export function ShipSettingsTab() {
  return (
    <div className="space-y-8 pt-4">
      <WorklistCategoriesSection />
    </div>
  );
}

function WorklistCategoriesSection() {
  const { t } = useTranslation(["settings", "common"]);
  const categoriesQuery = useWorklistCategories();
  const deleteCategory = useDeleteWorklistCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorklistCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorklistCategory | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:worklistCategories.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:worklistCategories.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-3" />
          {t("settings:worklistCategories.add")}
        </Button>
      </div>

      {categoriesQuery.error && <ErrorBanner message={errorMessage(categoriesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:worklistCategories.colName")}</TableHead>
              <TableHead>{t("settings:worklistCategories.colDescription")}</TableHead>
              <TableHead className="w-32">{t("settings:col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0
              ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("settings:worklistCategories.empty")}</TableCell></TableRow>
              : categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category.description ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" onClick={() => setEditTarget(category)}>
                          {t("common:common.edit")}
                        </Button>
                        <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(category)}>
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
        title={t("settings:worklistCategories.delete.title")}
        description={t("settings:worklistCategories.delete.confirm", { name: deleteTarget?.name })}
        pending={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = deleteTarget.name;
          deleteCategory.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:worklistCategories.toast.deleted", { name }));
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
    </section>
  );
}

interface CategoryDialogProps {
  readonly mode: "create" | "edit";
  readonly category?: WorklistCategory;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CategoryDialog({ mode, category, open, onOpenChange }: CategoryDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createCategory = useCreateWorklistCategory();
  const updateCategory = useUpdateWorklistCategory();

  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");

  const pending = createCategory.isPending || updateCategory.isPending;
  const error = createCategory.error ?? updateCategory.error;

  const buildInput = (): WorklistCategoryInput => ({
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
          toast.success(t("settings:worklistCategories.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (category) {
      updateCategory.mutate({ id: category.id, name: trimmed, ...buildInput() }, {
        onSuccess: () => {
          toast.success(t("settings:worklistCategories.toast.updated"));
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
            <DialogTitle>{mode === "create" ? t("settings:worklistCategories.addTitle") : t("settings:worklistCategories.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:worklistCategories.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="worklist-category-name">{t("settings:worklistCategories.fieldName")}</Label>
            <Input id="worklist-category-name" autoFocus required maxLength={255} value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="worklist-category-description">{t("settings:worklistCategories.fieldDescription")}</Label>
            <Textarea id="worklist-category-description" rows={2} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
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
