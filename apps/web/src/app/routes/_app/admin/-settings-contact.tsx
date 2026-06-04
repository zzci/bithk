// Body of the admin "Contact" settings tab. Hosts the global contact-categories
// vocabulary used to classify contacts. Mirrors GlobalCategoriesSection but is
// wired to the standalone contact-categories data layer.

import type { ContactCategory, ContactCategoryInput } from "@/shared/lib/api/contact-categories";
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
  useContactCategories,
  useCreateContactCategory,
  useDeleteContactCategory,
  useUpdateContactCategory,
} from "@/shared/lib/api/contact-categories";
import { errorMessage } from "@/shared/lib/errors";

export function ContactSettingsTab() {
  return (
    <div className="space-y-8 pt-4">
      <ContactCategoriesSection />
    </div>
  );
}

function ContactCategoriesSection() {
  const { t } = useTranslation(["settings", "common"]);
  const categoriesQuery = useContactCategories();
  const deleteCategory = useDeleteContactCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContactCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactCategory | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:contactCategories.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:contactCategories.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-3" />
          {t("settings:contactCategories.create")}
        </Button>
      </div>

      {categoriesQuery.error && <ErrorBanner message={errorMessage(categoriesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:contactCategories.colName")}</TableHead>
              <TableHead>{t("settings:contactCategories.colCode")}</TableHead>
              <TableHead>{t("settings:contactCategories.colDescription")}</TableHead>
              <TableHead className="w-32">{t("settings:col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0
              ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{t("settings:contactCategories.empty")}</TableCell></TableRow>
              : categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category.code ?? "—"}</TableCell>
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
    </section>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("settings:contactCategories.createTitle") : t("settings:contactCategories.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:contactCategories.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

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
