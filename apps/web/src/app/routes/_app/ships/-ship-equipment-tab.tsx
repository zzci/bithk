import type { EquipmentInput, EquipmentStatus, ShipEquipmentView, ShipView } from "@/shared/lib/api/ships";
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
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
import { useGlobalEquipmentManufacturers } from "@/shared/lib/api/global-equipment-manufacturers";
import { useShipEquipmentCategories } from "@/shared/lib/api/ship-equipment-categories";
import {
  EQUIPMENT_STATUSES,
  useCreateShipEquipment,
  useDeleteShipEquipment,
  useShipEquipment,
  useUpdateShipEquipment,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { EQUIPMENT_STATUS_BADGE } from "./-ship-colors";

interface ShipEquipmentTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

interface EquipmentFormState {
  readonly name: string;
  readonly categoryId: string;
  readonly manufacturerId: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly location: string;
  readonly status: EquipmentStatus;
  readonly note: string;
}

const EMPTY_FORM: EquipmentFormState = {
  name: "",
  categoryId: "",
  manufacturerId: "",
  model: "",
  serialNumber: "",
  location: "",
  status: "active",
  note: "",
};

const TEXT_FIELDS = ["model", "serialNumber", "location"] as const;

function formFromEquipment(row: ShipEquipmentView | null): EquipmentFormState {
  if (!row)
    return EMPTY_FORM;
  return {
    name: row.name,
    categoryId: row.categoryId ?? "",
    manufacturerId: row.manufacturerId ?? "",
    model: row.model ?? "",
    serialNumber: row.serialNumber ?? "",
    location: row.location ?? "",
    status: row.status,
    note: row.note ?? "",
  };
}

function toPayload(form: EquipmentFormState): { name: string } & EquipmentInput {
  const nullable = (value: string) => value.trim() ? value.trim() : null;
  return {
    name: form.name.trim(),
    categoryId: form.categoryId || null,
    manufacturerId: form.manufacturerId || null,
    model: nullable(form.model),
    serialNumber: nullable(form.serialNumber),
    location: nullable(form.location),
    status: form.status,
    note: nullable(form.note),
  };
}

const CATEGORY_ALL = "__all__";
const CATEGORY_NONE = "__none__";
const MANUFACTURER_NONE = "__none__";

export function ShipEquipmentTab({ ship, canManage }: ShipEquipmentTabProps) {
  const { t, i18n } = useTranslation(["ships", "common"]);
  const isZh = i18n.language?.startsWith("zh") ?? false;
  const equipmentQuery = useShipEquipment(ship.id);
  const createEquipment = useCreateShipEquipment();
  const updateEquipment = useUpdateShipEquipment();
  const deleteEquipment = useDeleteShipEquipment();

  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<ShipEquipmentView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShipEquipmentView | null>(null);
  const [category, setCategory] = useState<string>(CATEGORY_ALL);
  const [search, setSearch] = useState("");
  const equipment = useMemo(() => equipmentQuery.data ?? [], [equipmentQuery.data]);

  // Filter chips are built from the category ids actually present on the rows,
  // labelled with each row's resolved bilingual name.
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of equipment) {
      if (row.categoryId && !map.has(row.categoryId))
        map.set(row.categoryId, resolveCategoryName({ nameZh: row.categoryNameZh, nameEn: row.categoryNameEn }, isZh) || row.categoryId);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [equipment, isZh]);

  /* eslint-disable react/set-state-in-effect -- reset the filter when its category disappears. */
  useEffect(() => {
    if (category !== CATEGORY_ALL && !categories.some(([id]) => id === category))
      setCategory(CATEGORY_ALL);
  }, [categories, category]);
  /* eslint-enable react/set-state-in-effect */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return equipment.filter((row) => {
      if (category !== CATEGORY_ALL && row.categoryId !== category)
        return false;
      if (!q)
        return true;
      return [row.name, row.serialNumber, row.location, row.manufacturerName, row.model]
        .some(v => v?.toLowerCase().includes(q));
    });
  }, [equipment, category, search]);

  const colCount = canManage ? 8 : 7;

  const openCreate = () => {
    setEditTarget(null);
    setDialogMode("create");
  };

  const openEdit = (row: ShipEquipmentView) => {
    setEditTarget(row);
    setDialogMode("edit");
  };

  const closeDialog = () => setDialogMode(null);

  const handleDelete = () => {
    if (!deleteTarget)
      return;
    deleteEquipment.mutate(
      { shipId: ship.id, equipmentId: deleteTarget.id },
      { onSuccess: () => setDeleteTarget(null) },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("equipment.title")}</h2>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t("equipment.create")}
            </Button>
          </div>
        )}
      </div>

      {equipment.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[{ key: CATEGORY_ALL, label: t("equipment.filterAll") }, ...categories.map(([id, label]) => ({ key: id, label }))].map(opt => (
              <Button
                key={opt.key}
                variant={category === opt.key ? "default" : "outline"}
                className="h-8 shrink-0 rounded-full"
                aria-pressed={category === opt.key}
                onClick={() => setCategory(opt.key)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("equipment.searchPlaceholder")}
              aria-label={t("equipment.searchPlaceholder")}
              className="pl-8"
            />
          </div>
        </div>
      )}

      {equipmentQuery.error && <ErrorBanner message={errorMessage(equipmentQuery.error, t("common:common.error.loadFailed"))} />}
      {createEquipment.error && <ErrorBanner message={errorMessage(createEquipment.error, t("common:common.error.operationFailed"))} />}
      {updateEquipment.error && <ErrorBanner message={errorMessage(updateEquipment.error, t("common:common.error.saveFailed"))} />}
      {deleteEquipment.error && <ErrorBanner message={errorMessage(deleteEquipment.error, t("common:common.error.deleteFailed"))} />}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="border-0">
              <TableHead>{t("equipment.field.name")}</TableHead>
              <TableHead>{t("equipment.field.category")}</TableHead>
              <TableHead>{t("equipment.field.manufacturerModel")}</TableHead>
              <TableHead>{t("equipment.field.serialNumber")}</TableHead>
              <TableHead>{t("equipment.field.location")}</TableHead>
              <TableHead>{t("equipment.field.status")}</TableHead>
              <TableHead>{t("equipment.field.note")}</TableHead>
              {canManage && <TableHead className="w-28">{t("equipment.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-0">
            {equipmentQuery.isLoading
              ? <TableRow><TableCell colSpan={colCount} className="h-24 text-center text-muted-foreground">{t("equipment.loading")}</TableCell></TableRow>
              : equipment.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={colCount} className="h-24 text-center">
                        <div className="flex flex-col items-center justify-center gap-2 py-8">
                          <Package className="size-8 text-muted-foreground" aria-hidden="true" />
                          <p className="font-medium">{t("equipment.empty")}</p>
                          <p className="max-w-sm text-xs text-muted-foreground">{t("equipment.emptyHint")}</p>
                          {canManage && (
                            <Button onClick={openCreate}>
                              <Plus aria-hidden="true" />
                              {t("equipment.create")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                : filtered.length === 0
                  ? <TableRow><TableCell colSpan={colCount} className="h-24 text-center text-muted-foreground">{t("equipment.noMatches")}</TableCell></TableRow>
                  : filtered.map(row => (
                      <TableRow key={row.id} className="border-0">
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{(row.categoryId && resolveCategoryName({ nameZh: row.categoryNameZh, nameEn: row.categoryNameEn }, isZh)) || <span className="text-muted-foreground">{t("overview.notSet")}</span>}</TableCell>
                        <TableCell>
                          <div className="min-w-32">
                            <p>{row.manufacturerName || <span className="text-muted-foreground">{t("overview.notSet")}</span>}</p>
                            {row.model && <p className="font-mono text-xs text-muted-foreground">{row.model}</p>}
                          </div>
                        </TableCell>
                        <TableCell>{row.serialNumber || <span className="text-muted-foreground">{t("overview.notSet")}</span>}</TableCell>
                        <TableCell>{row.location || <span className="text-muted-foreground">{t("overview.notSet")}</span>}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn("text-xs", EQUIPMENT_STATUS_BADGE[row.status])}>
                            {t(`equipment.status.${row.status}` as const)}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {row.note || t("overview.notSet")}
                          </span>
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" aria-label={t("equipment.edit")} onClick={() => openEdit(row)}>
                                <Pencil className="size-4" />
                              </Button>
                              <Button variant="ghost" size="icon" aria-label={t("equipment.delete")} onClick={() => setDeleteTarget(row)}>
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
          </TableBody>
        </Table>
      </div>

      {canManage && (
        <EquipmentDialog
          shipShortId={ship.id}
          open={dialogMode !== null}
          mode={dialogMode ?? "create"}
          initial={editTarget}
          pending={createEquipment.isPending || updateEquipment.isPending}
          onOpenChange={open => !open && closeDialog()}
          onSubmit={(form) => {
            if (dialogMode === "edit" && editTarget) {
              updateEquipment.mutate(
                { shipId: ship.id, equipmentId: editTarget.id, ...toPayload(form) },
                { onSuccess: closeDialog },
              );
              return;
            }
            createEquipment.mutate(
              { shipId: ship.id, ...toPayload(form) },
              { onSuccess: closeDialog },
            );
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={t("equipment.deleteTitle")}
        description={t("equipment.deleteConfirm", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("equipment.delete")}
        pending={deleteEquipment.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function EquipmentDialog({
  shipShortId,
  open,
  onOpenChange,
  mode,
  initial,
  pending,
  onSubmit,
}: {
  readonly shipShortId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial: ShipEquipmentView | null;
  readonly pending: boolean;
  readonly onSubmit: (form: EquipmentFormState) => void;
}) {
  const { t, i18n } = useTranslation(["ships", "common"]);
  const isZh = i18n.language?.startsWith("zh") ?? false;
  const categories = useShipEquipmentCategories(shipShortId).data ?? [];
  const manufacturers = useGlobalEquipmentManufacturers().data ?? [];
  const [form, setForm] = useState(EMPTY_FORM);

  /* eslint-disable react/set-state-in-effect -- reseed the form whenever the dialog opens. */
  useEffect(() => {
    if (open)
      setForm(formFromEquipment(initial));
  }, [open, initial]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof EquipmentFormState>(key: K, value: EquipmentFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || pending)
      return;
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("equipment.createTitle") : t("equipment.editTitle")}</DialogTitle>
            <DialogDescription>{t("equipment.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="equipment-name">{t("equipment.field.name")}</Label>
            <Input id="equipment-name" autoFocus required value={form.name} onChange={e => set("name", e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="equipment-category">{t("equipment.field.category")}</Label>
              <Select
                value={form.categoryId || CATEGORY_NONE}
                onValueChange={v => v !== null && set("categoryId", v === CATEGORY_NONE ? "" : v)}
              >
                <SelectTrigger id="equipment-category" className="w-full">
                  <SelectValue placeholder={t("equipment.categoryPlaceholder")}>
                    {(v: string) => (v === CATEGORY_NONE
                      ? t("equipment.categoryNone")
                      : resolveCategoryName(categories.find(c => c.id === v) ?? { nameZh: null, nameEn: null }, isZh) || v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CATEGORY_NONE}>{t("equipment.categoryNone")}</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{resolveCategoryName(c, isZh)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="equipment-manufacturer">{t("equipment.field.manufacturer")}</Label>
              <Select
                value={form.manufacturerId || MANUFACTURER_NONE}
                onValueChange={v => v !== null && set("manufacturerId", v === MANUFACTURER_NONE ? "" : v)}
              >
                <SelectTrigger id="equipment-manufacturer" className="w-full">
                  <SelectValue placeholder={t("equipment.manufacturerPlaceholder")}>
                    {(v: string) => (v === MANUFACTURER_NONE
                      ? t("equipment.manufacturerNone")
                      : manufacturers.find(m => m.id === v)?.name ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUFACTURER_NONE}>{t("equipment.manufacturerNone")}</SelectItem>
                  {manufacturers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {TEXT_FIELDS.map(key => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`equipment-${key}`}>{t(`equipment.field.${key}` as const)}</Label>
                <Input id={`equipment-${key}`} value={form[key]} onChange={e => set(key, e.target.value)} />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="equipment-status">{t("equipment.field.status")}</Label>
              <Select value={form.status} onValueChange={v => v !== null && set("status", v as EquipmentStatus)}>
                <SelectTrigger id="equipment-status" className="w-full">
                  <SelectValue>{(v: string) => t(`equipment.status.${v}` as const)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_STATUSES.map(status => (
                    <SelectItem key={status} value={status}>{t(`equipment.status.${status}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="equipment-note">{t("equipment.field.note")}</Label>
            <Textarea id="equipment-note" rows={3} value={form.note} onChange={e => set("note", e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {mode === "create" ? t("equipment.create") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
