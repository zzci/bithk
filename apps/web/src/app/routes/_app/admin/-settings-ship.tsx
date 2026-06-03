// Body of the admin "Ship" settings tab. Manages two global vocabularies used
// across the ship module:
//   1. GLOBAL WORKLISTS — knowledge-base worklist templates (rows in the
//      `worklists` table with shipId NULL) that ships copy from. A worklist IS
//      the template; its `category` is plain free text.
//   2. EQUIPMENT CATEGORIES — the bilingual vocabulary ship equipment is
//      classified by (categoryId references). Each entry holds a Chinese and an
//      English name; equipment views resolve the locale-appropriate one.

import type { ShipEquipmentCategory } from "@/shared/lib/api/ship-equipment-categories";
import type { WorklistInput, WorklistView } from "@/shared/lib/api/ships";
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
  resolveCategoryName,
  useCreateShipEquipmentCategory,
  useDeleteShipEquipmentCategory,
  useShipEquipmentCategories,
  useUpdateShipEquipmentCategory,
} from "@/shared/lib/api/ship-equipment-categories";
import {
  useCreateGlobalWorklist,
  useDeleteGlobalWorklist,
  useGlobalWorklists,
  useUpdateGlobalWorklist,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";

export function ShipSettingsTab() {
  return (
    <div className="space-y-8 pt-4">
      <GlobalWorklistsSection />
      <EquipmentCategoriesSection />
    </div>
  );
}

function GlobalWorklistsSection() {
  const { t } = useTranslation(["settings", "common"]);
  const worklistsQuery = useGlobalWorklists(true);
  const deleteWorklist = useDeleteGlobalWorklist();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorklistView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorklistView | null>(null);

  const worklists = worklistsQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:globalWorklists.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:globalWorklists.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-3" />
          {t("settings:globalWorklists.add")}
        </Button>
      </div>

      {worklistsQuery.error && <ErrorBanner message={errorMessage(worklistsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:globalWorklists.colName")}</TableHead>
              <TableHead>{t("settings:globalWorklists.colCategory")}</TableHead>
              <TableHead className="w-32">{t("settings:col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {worklists.length === 0
              ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("settings:globalWorklists.empty")}</TableCell></TableRow>
              : worklists.map(worklist => (
                  <TableRow key={worklist.id}>
                    <TableCell className="font-medium">{worklist.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{worklist.category ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" onClick={() => setEditTarget(worklist)}>
                          {t("common:common.edit")}
                        </Button>
                        <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(worklist)}>
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
        title={t("settings:globalWorklists.delete.title")}
        description={t("settings:globalWorklists.delete.confirm", { name: deleteTarget?.name })}
        pending={deleteWorklist.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = deleteTarget.name;
          deleteWorklist.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:globalWorklists.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <WorklistDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <WorklistDialog
          mode="edit"
          worklist={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </section>
  );
}

interface WorklistDialogProps {
  readonly mode: "create" | "edit";
  readonly worklist?: WorklistView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function WorklistDialog({ mode, worklist, open, onOpenChange }: WorklistDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createWorklist = useCreateGlobalWorklist();
  const updateWorklist = useUpdateGlobalWorklist();

  const [name, setName] = useState(worklist?.name ?? "");
  const [category, setCategory] = useState(worklist?.category ?? "");
  const [checklist, setChecklist] = useState(worklist?.checklist ?? "");
  const [precautions, setPrecautions] = useState(worklist?.precautions ?? "");

  const pending = createWorklist.isPending || updateWorklist.isPending;
  const error = createWorklist.error ?? updateWorklist.error;

  const buildInput = (): WorklistInput => ({
    category: category.trim() || null,
    checklist: checklist.trim() || null,
    precautions: precautions.trim() || null,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending)
      return;
    if (mode === "create") {
      createWorklist.mutate({ name: trimmed, ...buildInput() }, {
        onSuccess: () => {
          toast.success(t("settings:globalWorklists.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (worklist) {
      updateWorklist.mutate({ id: worklist.id, name: trimmed, ...buildInput() }, {
        onSuccess: () => {
          toast.success(t("settings:globalWorklists.toast.updated"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("settings:globalWorklists.addTitle") : t("settings:globalWorklists.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:globalWorklists.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="global-worklist-name">{t("settings:globalWorklists.fieldName")}</Label>
            <Input id="global-worklist-name" autoFocus required maxLength={255} value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="global-worklist-cat">{t("settings:globalWorklists.fieldCategory")}</Label>
            <Input id="global-worklist-cat" maxLength={255} value={category} onChange={e => setCategory(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="global-worklist-checklist">{t("settings:globalWorklists.fieldChecklist")}</Label>
            <Textarea id="global-worklist-checklist" rows={4} value={checklist} onChange={e => setChecklist(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="global-worklist-precautions">{t("settings:globalWorklists.fieldPrecautions")}</Label>
            <Textarea id="global-worklist-precautions" rows={3} value={precautions} onChange={e => setPrecautions(e.target.value)} />
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

function EquipmentCategoriesSection() {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const isZh = i18n.language?.startsWith("zh") ?? false;
  const categoriesQuery = useShipEquipmentCategories();
  const deleteCategory = useDeleteShipEquipmentCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ShipEquipmentCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShipEquipmentCategory | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:shipEquipmentCategories.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:shipEquipmentCategories.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-3" />
          {t("settings:shipEquipmentCategories.add")}
        </Button>
      </div>

      {categoriesQuery.error && <ErrorBanner message={errorMessage(categoriesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:shipEquipmentCategories.colNameZh")}</TableHead>
              <TableHead>{t("settings:shipEquipmentCategories.colNameEn")}</TableHead>
              <TableHead className="w-32">{t("settings:col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0
              ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("settings:shipEquipmentCategories.empty")}</TableCell></TableRow>
              : categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.nameZh}</TableCell>
                    <TableCell className="font-medium">{category.nameEn}</TableCell>
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
        title={t("settings:shipEquipmentCategories.delete.title")}
        description={t("settings:shipEquipmentCategories.delete.confirm", { name: deleteTarget ? resolveCategoryName(deleteTarget, isZh) : "" })}
        pending={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = resolveCategoryName(deleteTarget, isZh);
          deleteCategory.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:shipEquipmentCategories.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <EquipmentCategoryDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <EquipmentCategoryDialog
          mode="edit"
          category={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </section>
  );
}

interface EquipmentCategoryDialogProps {
  readonly mode: "create" | "edit";
  readonly category?: ShipEquipmentCategory;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function EquipmentCategoryDialog({ mode, category, open, onOpenChange }: EquipmentCategoryDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createCategory = useCreateShipEquipmentCategory();
  const updateCategory = useUpdateShipEquipmentCategory();

  const [nameZh, setNameZh] = useState(category?.nameZh ?? "");
  const [nameEn, setNameEn] = useState(category?.nameEn ?? "");

  const pending = createCategory.isPending || updateCategory.isPending;
  const error = createCategory.error ?? updateCategory.error;
  const valid = nameZh.trim().length > 0 && nameEn.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || pending)
      return;
    const body = { nameZh: nameZh.trim(), nameEn: nameEn.trim() };
    if (mode === "create") {
      createCategory.mutate(body, {
        onSuccess: () => {
          toast.success(t("settings:shipEquipmentCategories.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (category) {
      updateCategory.mutate({ id: category.id, ...body }, {
        onSuccess: () => {
          toast.success(t("settings:shipEquipmentCategories.toast.updated"));
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
            <DialogTitle>{mode === "create" ? t("settings:shipEquipmentCategories.addTitle") : t("settings:shipEquipmentCategories.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:shipEquipmentCategories.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="ship-equipment-category-zh">{t("settings:shipEquipmentCategories.fieldNameZh")}</Label>
            <Input id="ship-equipment-category-zh" autoFocus required maxLength={255} value={nameZh} onChange={e => setNameZh(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ship-equipment-category-en">{t("settings:shipEquipmentCategories.fieldNameEn")}</Label>
            <Input id="ship-equipment-category-en" required maxLength={255} value={nameEn} onChange={e => setNameEn(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {mode === "create" ? t("common:common.add") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
