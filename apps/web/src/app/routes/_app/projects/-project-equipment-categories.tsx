// Per-project equipment-category management, surfaced from the Equipment tab.
//
// Mirrors the admin global-template section (-settings-ship.tsx) and the
// per-project procurement-categories surface (-project-settings-categories.tsx).
// The project owns its own category set, copied from the global template when
// the `equipment` section is provisioned; create/edit/delete all hit
// `/projects/:projectId/equipment-categories`. All write affordances are gated
// by the project `canManage` flag.

import type { ProjectEquipmentCategory } from "@/shared/lib/api/project-sections";
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
import { resolveCategoryName } from "@/shared/lib/api/global-equipment-categories";
import {
  useCreateProjectEquipmentCategory,
  useDeleteProjectEquipmentCategory,
  useProjectEquipmentCategories,
  useUpdateProjectEquipmentCategory,
} from "@/shared/lib/api/project-sections";
import { errorMessage } from "@/shared/lib/errors";

interface ProjectEquipmentCategoriesSectionProps {
  readonly projectId: string;
  readonly canManage: boolean;
}

export function ProjectEquipmentCategoriesSection({ projectId, canManage }: ProjectEquipmentCategoriesSectionProps) {
  const { t, i18n } = useTranslation(["ships", "common"]);
  const isZh = i18n.language?.startsWith("zh") ?? false;
  const categoriesQuery = useProjectEquipmentCategories(projectId);
  const deleteCategory = useDeleteProjectEquipmentCategory(projectId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectEquipmentCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectEquipmentCategory | null>(null);

  const categories = categoriesQuery.data ?? [];
  // The Actions column only exists for managers, so the empty-state row spans
  // one fewer cell for read-only viewers.
  const colSpan = canManage ? 4 : 3;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-muted-foreground">{t("equipmentCategories.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("equipmentCategories.description")}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t("equipmentCategories.create")}
          </Button>
        )}
      </div>

      {categoriesQuery.error && <ErrorBanner message={errorMessage(categoriesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("equipmentCategories.colNameZh")}</TableHead>
              <TableHead>{t("equipmentCategories.colNameEn")}</TableHead>
              <TableHead>{t("equipmentCategories.colCode")}</TableHead>
              {canManage && <TableHead className="w-32">{t("equipmentCategories.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0
              ? <TableRow><TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">{t("equipmentCategories.empty")}</TableCell></TableRow>
              : categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.nameZh}</TableCell>
                    <TableCell className="font-medium">{category.nameEn}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category.code ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => setEditTarget(category)}>
                            {t("equipmentCategories.edit")}
                          </Button>
                          <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(category)}>
                            {t("equipmentCategories.delete")}
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
        title={t("equipmentCategories.dialog.deleteTitle")}
        description={t("equipmentCategories.dialog.deleteConfirm", { name: deleteTarget ? resolveCategoryName(deleteTarget, isZh) : "" })}
        pending={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = resolveCategoryName(deleteTarget, isZh);
          deleteCategory.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("equipmentCategories.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <ProjectEquipmentCategoryDialog projectId={projectId} mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <ProjectEquipmentCategoryDialog
          projectId={projectId}
          mode="edit"
          category={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </section>
  );
}

interface ProjectEquipmentCategoryDialogProps {
  readonly projectId: string;
  readonly mode: "create" | "edit";
  readonly category?: ProjectEquipmentCategory;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function ProjectEquipmentCategoryDialog({ projectId, mode, category, open, onOpenChange }: ProjectEquipmentCategoryDialogProps) {
  const { t } = useTranslation(["ships", "common"]);
  const createCategory = useCreateProjectEquipmentCategory(projectId);
  const updateCategory = useUpdateProjectEquipmentCategory(projectId);

  const [nameZh, setNameZh] = useState(category?.nameZh ?? "");
  const [nameEn, setNameEn] = useState(category?.nameEn ?? "");
  const [code, setCode] = useState(category?.code ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [submitted, setSubmitted] = useState(false);

  const pending = createCategory.isPending || updateCategory.isPending;
  const error = createCategory.error ?? updateCategory.error;
  const nameZhMissing = nameZh.trim().length === 0;
  const nameEnMissing = nameEn.trim().length === 0;
  const valid = !nameZhMissing && !nameEnMissing;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || pending)
      return;
    const body = {
      nameZh: nameZh.trim(),
      nameEn: nameEn.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
    };
    if (mode === "create") {
      createCategory.mutate(body, {
        onSuccess: () => {
          toast.success(t("equipmentCategories.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (category) {
      updateCategory.mutate({ id: category.id, ...body }, {
        onSuccess: () => {
          toast.success(t("equipmentCategories.toast.updated"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("equipmentCategories.dialog.createTitle") : t("equipmentCategories.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("equipmentCategories.dialog.description")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="project-equipment-category-zh">{t("equipmentCategories.colNameZh")}</Label>
            <Input
              id="project-equipment-category-zh"
              autoFocus
              maxLength={255}
              placeholder={t("equipmentCategories.placeholders.nameZh")}
              value={nameZh}
              onChange={e => setNameZh(e.target.value)}
            />
            {submitted && nameZhMissing && <p className="text-xs text-destructive">{t("equipmentCategories.validation.nameZhRequired")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-equipment-category-en">{t("equipmentCategories.colNameEn")}</Label>
            <Input
              id="project-equipment-category-en"
              maxLength={255}
              placeholder={t("equipmentCategories.placeholders.nameEn")}
              value={nameEn}
              onChange={e => setNameEn(e.target.value)}
            />
            {submitted && nameEnMissing && <p className="text-xs text-destructive">{t("equipmentCategories.validation.nameEnRequired")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-equipment-category-code">{t("equipmentCategories.colCode")}</Label>
            <Input id="project-equipment-category-code" maxLength={100} value={code} onChange={e => setCode(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-equipment-category-description">{t("equipmentCategories.fieldDescription")}</Label>
            <Textarea id="project-equipment-category-description" rows={2} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
