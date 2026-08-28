// Body of the admin "Ship" settings tab. Manages the global vocabularies the
// ship-preset project sections copy from:
//   1. GLOBAL WORKLISTS — knowledge-base worklist templates (`/worklists`, no
//      owning project) that a project's `worklist` section copies from. A
//      worklist IS the template; it carries tags that are snapshotted into each
//      project copy.
//   2. EQUIPMENT CATEGORY TEMPLATE — the bilingual vocabulary template each
//      project copies into its own category set when the `equipment` section is
//      provisioned. Each entry holds a Chinese and an English name; projects
//      then manage their own copies and equipment views resolve the
//      locale-appropriate name from the per-project row.
//   3. EQUIPMENT MANUFACTURERS — a flat global vocabulary equipment references
//      directly; there is no per-project copy.

import type { GlobalEquipmentCategory } from "@/shared/lib/api/global-equipment-categories";
import type { GlobalEquipmentManufacturer } from "@/shared/lib/api/global-equipment-manufacturers";
import type { WorklistInput, WorklistView } from "@/shared/lib/api/project-sections";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CrudDialog } from "@/shared/components/crud/crud-dialog";
import { CrudListSection } from "@/shared/components/crud/crud-list-section";
import { TagInput } from "@/shared/components/tags";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { TableCell } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  resolveCategoryName,
  useCreateGlobalEquipmentCategory,
  useDeleteGlobalEquipmentCategory,
  useGlobalEquipmentCategories,
  useUpdateGlobalEquipmentCategory,
} from "@/shared/lib/api/global-equipment-categories";
import {
  useCreateGlobalEquipmentManufacturer,
  useDeleteGlobalEquipmentManufacturer,
  useGlobalEquipmentManufacturers,
  useUpdateGlobalEquipmentManufacturer,
} from "@/shared/lib/api/global-equipment-manufacturers";
import {
  useCreateGlobalWorklist,
  useDeleteGlobalWorklist,
  useGlobalWorklists,
  useUpdateGlobalWorklist,
  useWorklistTags,
} from "@/shared/lib/api/project-sections";
import { errorMessage } from "@/shared/lib/errors";

export function ShipSettingsTab() {
  return (
    <div className="space-y-8 pt-4">
      <GlobalWorklistsSection />
      <GlobalEquipmentCategoriesSection />
      <GlobalEquipmentManufacturersSection />
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
    <CrudListSection
      title={t("settings:globalWorklists.title")}
      description={t("settings:globalWorklists.description")}
      addLabel={t("settings:globalWorklists.create")}
      onAdd={() => setCreateOpen(true)}
      errorMessage={worklistsQuery.error ? errorMessage(worklistsQuery.error, t("common:common.error.loadFailed")) : null}
      columns={[
        { header: t("settings:globalWorklists.colName") },
        { header: t("settings:globalWorklists.colTags") },
      ]}
      actionsLabel={t("settings:col.actions")}
      rows={worklists}
      emptyLabel={t("settings:globalWorklists.empty")}
      renderRow={worklist => (
        <>
          <TableCell className="font-medium">{worklist.name}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{worklist.tags.map(tag => tag.name).join(", ") || "—"}</TableCell>
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
    </CrudListSection>
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
    <CrudDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      createTitle={t("settings:globalWorklists.createTitle")}
      editTitle={t("settings:globalWorklists.editTitle")}
      description={t("settings:globalWorklists.dialogDescription")}
      errorMessage={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      pending={pending}
      submitDisabled={!name.trim()}
      onSubmit={submit}
      contentClassName="max-h-[90svh] overflow-y-auto sm:max-w-lg"
    >
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
    </CrudDialog>
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
    <CrudListSection
      title={t("settings:globalEquipmentCategories.title")}
      description={t("settings:globalEquipmentCategories.description")}
      addLabel={t("settings:globalEquipmentCategories.create")}
      onAdd={() => setCreateOpen(true)}
      errorMessage={categoriesQuery.error ? errorMessage(categoriesQuery.error, t("common:common.error.loadFailed")) : null}
      columns={[
        { header: t("settings:globalEquipmentCategories.colNameZh") },
        { header: t("settings:globalEquipmentCategories.colNameEn") },
        { header: t("settings:globalEquipmentCategories.colCode") },
      ]}
      actionsLabel={t("settings:globalEquipmentCategories.actions")}
      rows={categories}
      emptyLabel={t("settings:globalEquipmentCategories.empty")}
      renderRow={category => (
        <>
          <TableCell className="font-medium">{category.nameZh}</TableCell>
          <TableCell className="font-medium">{category.nameEn}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{category.code ?? "—"}</TableCell>
        </>
      )}
      editLabel={t("settings:globalEquipmentCategories.edit")}
      deleteLabel={t("settings:globalEquipmentCategories.delete")}
      onEdit={setEditTarget}
      onDelete={setDeleteTarget}
    >
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
    </CrudListSection>
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
    <CrudDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      createTitle={t("settings:globalEquipmentCategories.dialog.createTitle")}
      editTitle={t("settings:globalEquipmentCategories.dialog.editTitle")}
      description={t("settings:globalEquipmentCategories.dialog.description")}
      errorMessage={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      pending={pending}
      submitDisabled={!valid}
      onSubmit={submit}
      noValidate
    >
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
    </CrudDialog>
  );
}

function GlobalEquipmentManufacturersSection() {
  const { t } = useTranslation(["settings", "common"]);
  const manufacturersQuery = useGlobalEquipmentManufacturers();
  const deleteManufacturer = useDeleteGlobalEquipmentManufacturer();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GlobalEquipmentManufacturer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalEquipmentManufacturer | null>(null);

  const manufacturers = manufacturersQuery.data ?? [];

  return (
    <CrudListSection
      title={t("settings:globalEquipmentManufacturers.title")}
      description={t("settings:globalEquipmentManufacturers.description")}
      addLabel={t("settings:globalEquipmentManufacturers.add")}
      onAdd={() => setCreateOpen(true)}
      errorMessage={manufacturersQuery.error ? errorMessage(manufacturersQuery.error, t("common:common.error.loadFailed")) : null}
      columns={[
        { header: t("settings:globalEquipmentManufacturers.colName") },
        { header: t("settings:globalEquipmentManufacturers.colCode") },
      ]}
      actionsLabel={t("settings:globalEquipmentManufacturers.actions")}
      rows={manufacturers}
      emptyLabel={t("settings:globalEquipmentManufacturers.empty")}
      renderRow={manufacturer => (
        <>
          <TableCell className="font-medium">{manufacturer.name}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{manufacturer.code ?? "—"}</TableCell>
        </>
      )}
      editLabel={t("settings:globalEquipmentManufacturers.edit")}
      deleteLabel={t("settings:globalEquipmentManufacturers.delete")}
      onEdit={setEditTarget}
      onDelete={setDeleteTarget}
    >
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("settings:globalEquipmentManufacturers.dialog.deleteTitle")}
        description={t("settings:globalEquipmentManufacturers.dialog.deleteConfirm", { name: deleteTarget?.name ?? "" })}
        pending={deleteManufacturer.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          const name = deleteTarget.name;
          deleteManufacturer.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t("settings:globalEquipmentManufacturers.toast.deleted", { name }));
              setDeleteTarget(null);
            },
            onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
          });
        }}
      />

      <GlobalEquipmentManufacturerDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <GlobalEquipmentManufacturerDialog
          mode="edit"
          manufacturer={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
    </CrudListSection>
  );
}

interface GlobalEquipmentManufacturerDialogProps {
  readonly mode: "create" | "edit";
  readonly manufacturer?: GlobalEquipmentManufacturer;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function GlobalEquipmentManufacturerDialog({ mode, manufacturer, open, onOpenChange }: GlobalEquipmentManufacturerDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const createManufacturer = useCreateGlobalEquipmentManufacturer();
  const updateManufacturer = useUpdateGlobalEquipmentManufacturer();

  const [name, setName] = useState(manufacturer?.name ?? "");
  const [code, setCode] = useState(manufacturer?.code ?? "");
  const [description, setDescription] = useState(manufacturer?.description ?? "");
  const [submitted, setSubmitted] = useState(false);

  const pending = createManufacturer.isPending || updateManufacturer.isPending;
  const error = createManufacturer.error ?? updateManufacturer.error;
  const nameMissing = name.trim().length === 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameMissing || pending)
      return;
    const body = {
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
    };
    if (mode === "create") {
      createManufacturer.mutate(body, {
        onSuccess: () => {
          toast.success(t("settings:globalEquipmentManufacturers.toast.created"));
          onOpenChange(false);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
    }
    else if (manufacturer) {
      updateManufacturer.mutate({ id: manufacturer.id, ...body }, {
        onSuccess: () => {
          toast.success(t("settings:globalEquipmentManufacturers.toast.updated"));
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
      createTitle={t("settings:globalEquipmentManufacturers.dialog.createTitle")}
      editTitle={t("settings:globalEquipmentManufacturers.dialog.editTitle")}
      description={t("settings:globalEquipmentManufacturers.dialog.description")}
      errorMessage={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      pending={pending}
      submitDisabled={nameMissing}
      onSubmit={submit}
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="equipment-manufacturer-name">{t("settings:globalEquipmentManufacturers.colName")}</Label>
        <Input
          id="equipment-manufacturer-name"
          autoFocus
          maxLength={100}
          placeholder={t("settings:globalEquipmentManufacturers.placeholders.name")}
          value={name}
          onChange={e => setName(e.target.value)}
        />
        {submitted && nameMissing && <p className="text-xs text-destructive">{t("settings:globalEquipmentManufacturers.validation.nameRequired")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="equipment-manufacturer-code">{t("settings:globalEquipmentManufacturers.colCode")}</Label>
        <Input
          id="equipment-manufacturer-code"
          maxLength={200}
          placeholder={t("settings:globalEquipmentManufacturers.placeholders.code")}
          value={code}
          onChange={e => setCode(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="equipment-manufacturer-description">{t("settings:globalEquipmentManufacturers.placeholders.description")}</Label>
        <Textarea
          id="equipment-manufacturer-description"
          rows={2}
          maxLength={200}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
    </CrudDialog>
  );
}
