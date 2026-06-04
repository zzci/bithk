// Body of the admin "Ship" settings tab. Manages two global vocabularies used
// across the ship module:
//   1. GLOBAL WORKLISTS — knowledge-base worklist templates (rows in the
//      `worklists` table with shipId NULL) that ships copy from. A worklist IS
//      the template; it carries tags that are snapshotted into each ship copy.
//   2. EQUIPMENT CATEGORY TEMPLATE — the bilingual vocabulary template each
//      ship copies into its own category set on creation. Each entry holds a
//      Chinese and an English name; ships then manage their own copies and
//      equipment views resolve the locale-appropriate name from the per-ship row.

import type { GlobalEquipmentCategory } from "@/shared/lib/api/global-equipment-categories";
import type { WorklistInput, WorklistView } from "@/shared/lib/api/ships";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { TagInput } from "@/shared/components/tags";
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
  useCreateGlobalEquipmentCategory,
  useDeleteGlobalEquipmentCategory,
  useGlobalEquipmentCategories,
  useUpdateGlobalEquipmentCategory,
} from "@/shared/lib/api/global-equipment-categories";
import {
  useCreateGlobalWorklist,
  useDeleteGlobalWorklist,
  useGlobalWorklists,
  useUpdateGlobalWorklist,
  useWorklistTags,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";

export function ShipSettingsTab() {
  return (
    <div className="space-y-8 pt-4">
      <GlobalWorklistsSection />
      <GlobalEquipmentCategoriesSection />
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
          {t("settings:globalWorklists.create")}
        </Button>
      </div>

      {worklistsQuery.error && <ErrorBanner message={errorMessage(worklistsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:globalWorklists.colName")}</TableHead>
              <TableHead>{t("settings:globalWorklists.colTags")}</TableHead>
              <TableHead className="w-32">{t("settings:col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {worklists.length === 0
              ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">{t("settings:globalWorklists.empty")}</TableCell></TableRow>
              : worklists.map(worklist => (
                  <TableRow key={worklist.id}>
                    <TableCell className="font-medium">{worklist.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{worklist.tags.map(tag => tag.name).join(", ") || "—"}</TableCell>
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
  const [tags, setTags] = useState<readonly string[]>(worklist?.tags.map(tag => tag.name) ?? []);
  const [checklist, setChecklist] = useState(worklist?.checklist ?? "");
  const [precautions, setPrecautions] = useState(worklist?.precautions ?? "");
  const worklistTags = useWorklistTags().data ?? [];

  const pending = createWorklist.isPending || updateWorklist.isPending;
  const error = createWorklist.error ?? updateWorklist.error;

  const buildInput = (): WorklistInput => ({
    tags,
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
            <DialogTitle>{mode === "create" ? t("settings:globalWorklists.createTitle") : t("settings:globalWorklists.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:globalWorklists.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="global-worklist-name">{t("settings:globalWorklists.fieldName")}</Label>
            <Input id="global-worklist-name" autoFocus required maxLength={255} value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>{t("settings:globalWorklists.fieldTags")}</Label>
            <TagInput value={tags} onChange={setTags} suggestions={worklistTags.map(tag => tag.name)} namespace="ships" />
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
              {mode === "create" ? t("common:common.create") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GlobalEquipmentCategoriesSection() {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const isZh = i18n.language?.startsWith("zh") ?? false;
  const categoriesQuery = useGlobalEquipmentCategories();
  const deleteCategory = useDeleteGlobalEquipmentCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GlobalEquipmentCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalEquipmentCategory | null>(null);

  const categories = categoriesQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:globalEquipmentCategories.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:globalEquipmentCategories.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-3" />
          {t("settings:globalEquipmentCategories.create")}
        </Button>
      </div>

      {categoriesQuery.error && <ErrorBanner message={errorMessage(categoriesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:globalEquipmentCategories.colNameZh")}</TableHead>
              <TableHead>{t("settings:globalEquipmentCategories.colNameEn")}</TableHead>
              <TableHead>{t("settings:globalEquipmentCategories.colCode")}</TableHead>
              <TableHead className="w-32">{t("settings:globalEquipmentCategories.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0
              ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{t("settings:globalEquipmentCategories.empty")}</TableCell></TableRow>
              : categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.nameZh}</TableCell>
                    <TableCell className="font-medium">{category.nameEn}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{category.code ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" onClick={() => setEditTarget(category)}>
                          {t("settings:globalEquipmentCategories.edit")}
                        </Button>
                        <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(category)}>
                          {t("settings:globalEquipmentCategories.delete")}
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
        title={t("settings:globalEquipmentCategories.dialog.deleteTitle")}
        description={t("settings:globalEquipmentCategories.dialog.deleteConfirm", { name: deleteTarget ? resolveCategoryName(deleteTarget, isZh) : "" })}
        pending={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = resolveCategoryName(deleteTarget, isZh);
          deleteCategory.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:globalEquipmentCategories.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <GlobalEquipmentCategoryDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <GlobalEquipmentCategoryDialog
          mode="edit"
          category={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </section>
  );
}

interface GlobalEquipmentCategoryDialogProps {
  readonly mode: "create" | "edit";
  readonly category?: GlobalEquipmentCategory;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function GlobalEquipmentCategoryDialog({ mode, category, open, onOpenChange }: GlobalEquipmentCategoryDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createCategory = useCreateGlobalEquipmentCategory();
  const updateCategory = useUpdateGlobalEquipmentCategory();

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
          toast.success(t("settings:globalEquipmentCategories.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (category) {
      updateCategory.mutate({ id: category.id, ...body }, {
        onSuccess: () => {
          toast.success(t("settings:globalEquipmentCategories.toast.updated"));
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
            <DialogTitle>{mode === "create" ? t("settings:globalEquipmentCategories.dialog.createTitle") : t("settings:globalEquipmentCategories.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("settings:globalEquipmentCategories.dialog.description")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="equipment-category-zh">{t("settings:globalEquipmentCategories.colNameZh")}</Label>
            <Input
              id="equipment-category-zh"
              autoFocus
              maxLength={255}
              placeholder={t("settings:globalEquipmentCategories.placeholders.nameZh")}
              value={nameZh}
              onChange={e => setNameZh(e.target.value)}
            />
            {submitted && nameZhMissing && <p className="text-xs text-destructive">{t("settings:globalEquipmentCategories.validation.nameZhRequired")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="equipment-category-en">{t("settings:globalEquipmentCategories.colNameEn")}</Label>
            <Input
              id="equipment-category-en"
              maxLength={255}
              placeholder={t("settings:globalEquipmentCategories.placeholders.nameEn")}
              value={nameEn}
              onChange={e => setNameEn(e.target.value)}
            />
            {submitted && nameEnMissing && <p className="text-xs text-destructive">{t("settings:globalEquipmentCategories.validation.nameEnRequired")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="equipment-category-code">{t("settings:globalEquipmentCategories.colCode")}</Label>
            <Input id="equipment-category-code" maxLength={100} value={code} onChange={e => setCode(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="equipment-category-description">{t("settings:globalEquipmentCategories.fieldDescription")}</Label>
            <Textarea id="equipment-category-description" rows={2} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {mode === "create" ? t("common:common.create") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
