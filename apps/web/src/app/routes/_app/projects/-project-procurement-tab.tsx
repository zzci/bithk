// Procurement tab: filterable list (status + category) + create dialog + per-row
// status change and delete. Mounted only when the caller has procurement.view,
// so it assumes read access; create/delete/status need canManage.

import type {
  CreateProcurementInput,
  ProcurementRow,
  ProcurementStatus,
} from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
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
import { useContacts } from "@/shared/lib/api/contacts";
import {
  PROCUREMENT_STATUSES,
  useChangeProcurementStatus,
  useCreateProcurement,
  useDeleteProcurement,
  useProcurements,
} from "@/shared/lib/api/procurement";
import { useProcurementCategories } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { buildMemberLabelMap } from "./-member-helpers";

interface ProjectProcurementTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  readonly canManage: boolean;
}

export function ProjectProcurementTab({ projectId, members, userNames, canManage }: ProjectProcurementTabProps) {
  const { t } = useTranslation(["projects", "common"]);

  const [statusFilter, setStatusFilter] = useState("__all__");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementRow | null>(null);

  const procurementsQuery = useProcurements(projectId, {
    status: statusFilter === "__all__" ? undefined : (statusFilter as ProcurementStatus),
    categoryId: categoryFilter === "__all__" ? undefined : categoryFilter,
    page,
  });
  const draftSummaryQuery = useProcurements(projectId, { status: "draft", limit: 1000 });
  const requestedSummaryQuery = useProcurements(projectId, { status: "requested", limit: 1000 });
  const orderedSummaryQuery = useProcurements(projectId, { status: "ordered", limit: 1000 });
  const receivedSummaryQuery = useProcurements(projectId, { status: "received", limit: 1000 });
  const closedSummaryQuery = useProcurements(projectId, { status: "closed", limit: 1000 });
  const suppliersQuery = useContacts();
  const categoriesQuery = useProcurementCategories(projectId);
  const changeStatus = useChangeProcurementStatus();
  const deleteProcurement = useDeleteProcurement();

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const suppliers = useMemo(
    () => (suppliersQuery.data ?? []).map(contact => ({ id: contact.id, name: contact.name })),
    [suppliersQuery.data],
  );
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const supplierNames = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers]);
  const categoryNames = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const rows = procurementsQuery.data?.data ?? [];
  const meta = procurementsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;
  const stageSummaries: Record<ProcurementStatus, { readonly count: number | undefined; readonly rows: readonly ProcurementRow[] }> = {
    draft: { count: draftSummaryQuery.data?.meta.total, rows: draftSummaryQuery.data?.data ?? [] },
    requested: { count: requestedSummaryQuery.data?.meta.total, rows: requestedSummaryQuery.data?.data ?? [] },
    ordered: { count: orderedSummaryQuery.data?.meta.total, rows: orderedSummaryQuery.data?.data ?? [] },
    received: { count: receivedSummaryQuery.data?.meta.total, rows: receivedSummaryQuery.data?.data ?? [] },
    closed: { count: closedSummaryQuery.data?.meta.total, rows: closedSummaryQuery.data?.data ?? [] },
  };

  const supplierName = (id: string | null) =>
    id ? supplierNames.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;
  const categoryName = (id: string | null) =>
    id ? categoryNames.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;
  const memberName = (id: string | null) =>
    id ? memberLabels.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;

  const formatAmount = (row: ProcurementRow) => {
    if (row.amount === null)
      return "—";
    return row.currency ? `${row.amount} ${row.currency}` : String(row.amount);
  };

  const formatSummaryAmount = (summaryRows: readonly ProcurementRow[]) => {
    const amountRows = summaryRows.filter(row => row.amount !== null);
    if (amountRows.length === 0)
      return "—";
    const currencies = new Set(amountRows.map(row => row.currency ?? ""));
    if (currencies.size > 1)
      return t("procurement.mixedCurrencies");
    const currency = amountRows[0]?.currency;
    const total = amountRows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return currency ? `${total} ${currency}` : String(total);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{t("procurement.pipeline.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("procurement.pipeline.description")}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {PROCUREMENT_STATUSES.map(status => (
            <button
              key={status}
              type="button"
              className="rounded-md border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:border-primary data-[active=true]:bg-primary/5"
              data-active={statusFilter === status}
              aria-pressed={statusFilter === status}
              onClick={() => {
                setStatusFilter(statusFilter === status ? "__all__" : status);
                setPage(1);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t(`procurement.status.${status}` as const)}</span>
                <Badge variant="secondary" className="text-xs">
                  {stageSummaries[status].count ?? "—"}
                </Badge>
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">
                {formatSummaryAmount(stageSummaries[status].rows)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t("procurement.pipeline.amount")}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Select
            value={categoryFilter}
            onValueChange={(v) => {
              if (v === null)
                return;
              setCategoryFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue>
                {(v: string) => (v === "__all__" ? t("procurement.allCategories") : categoryNames.get(v) ?? v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("procurement.allCategories")}</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("procurement.create")}
          </Button>
        )}
      </div>

      {procurementsQuery.error && <ErrorBanner message={errorMessage(procurementsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="border-0">
              <TableHead>{t("procurement.col.itemName")}</TableHead>
              <TableHead>{t("procurement.col.status")}</TableHead>
              <TableHead>{t("procurement.col.amount")}</TableHead>
              <TableHead>{t("procurement.col.category")}</TableHead>
              <TableHead>{t("procurement.col.supplier")}</TableHead>
              <TableHead>{t("procurement.col.assignee")}</TableHead>
              {canManage && <TableHead>{t("procurement.col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-0">
            {procurementsQuery.isLoading
              ? <TableRow><TableCell colSpan={canManage ? 7 : 6} className="h-24 text-center text-muted-foreground">{t("procurement.loading")}</TableCell></TableRow>
              : rows.length === 0
                ? <TableRow><TableCell colSpan={canManage ? 7 : 6} className="h-24 text-center text-muted-foreground">{t("procurement.empty")}</TableCell></TableRow>
                : rows.map(row => (
                    <TableRow key={row.id} className="border-0">
                      <TableCell className="font-medium">{row.itemName}</TableCell>
                      <TableCell>
                        {canManage
                          ? (
                              <Select
                                value={row.status}
                                onValueChange={(v) => {
                                  if (v === null || v === row.status)
                                    return;
                                  changeStatus.mutate({ projectId, id: row.id, status: v as ProcurementStatus });
                                }}
                              >
                                <SelectTrigger size="sm" className="w-32" aria-label={t("procurement.changeStatus")}>
                                  <SelectValue>
                                    {(v: string) => t(`procurement.status.${v}` as const)}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {PROCUREMENT_STATUSES.map(s => (
                                    <SelectItem key={s} value={s}>{t(`procurement.status.${s}` as const)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )
                          : (
                              <Badge variant="outline" className="text-xs">{t(`procurement.status.${row.status}` as const)}</Badge>
                            )}
                      </TableCell>
                      <TableCell className="text-sm">{formatAmount(row)}</TableCell>
                      <TableCell className="text-sm">{categoryName(row.categoryId)}</TableCell>
                      <TableCell className="text-sm">{supplierName(row.supplierId)}</TableCell>
                      <TableCell className="text-sm">{memberName(row.assigneeMemberId)}</TableCell>
                      {canManage && (
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row)}>
                            {t("common:common.delete")}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
        {totalPages > 1 && meta && (
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-muted-foreground">{t("procurement.total", { count: meta.total })}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("procurement.delete.title")}
        description={t("procurement.delete.confirm", { name: deleteTarget?.itemName })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteProcurement.mutate({ projectId, id: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />

      {canManage && (
        <CreateProcurementDialog
          projectId={projectId}
          members={members}
          memberLabels={memberLabels}
          suppliers={suppliers}
          categories={categories}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
    </div>
  );
}

interface CreateProcurementDialogProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly suppliers: readonly { readonly id: string; readonly name: string }[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CreateProcurementDialog({ projectId, members, memberLabels, suppliers, categories, open, onOpenChange }: CreateProcurementDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createProcurement = useCreateProcurement();
  const [itemName, setItemName] = useState("");
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [supplierId, setSupplierId] = useState("__none__");
  const [categoryId, setCategoryId] = useState("__none__");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");

  const reset = () => {
    setItemName("");
    setTitle("");
    setQuantity("");
    setAmount("");
    setCurrency("");
    setSupplierId("__none__");
    setCategoryId("__none__");
    setAssigneeMemberId("__none__");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!itemName.trim() || createProcurement.isPending)
      return;
    const body: CreateProcurementInput = {
      itemName: itemName.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(quantity ? { quantity: Number(quantity) } : {}),
      ...(amount ? { amount: Number(amount) } : {}),
      ...(currency.trim() ? { currency: currency.trim() } : {}),
      ...(supplierId !== "__none__" ? { supplierId } : {}),
      ...(categoryId !== "__none__" ? { categoryId } : {}),
      ...(assigneeMemberId !== "__none__" ? { assigneeMemberId } : {}),
    };
    createProcurement.mutate({ projectId, ...body }, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("procurement.createTitle")}</DialogTitle>
            <DialogDescription>{t("procurement.createDescription")}</DialogDescription>
          </DialogHeader>

          {createProcurement.error && <ErrorBanner message={errorMessage(createProcurement.error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="proc-item">{t("procurement.field.itemName")}</Label>
            <Input id="proc-item" autoFocus required value={itemName} onChange={e => setItemName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proc-title">{t("procurement.field.title")}</Label>
            <Input id="proc-title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proc-qty">{t("procurement.field.quantity")}</Label>
              <Input id="proc-qty" type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-amount">{t("procurement.field.amount")}</Label>
              <Input id="proc-amount" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-currency">{t("procurement.field.currency")}</Label>
              <Input id="proc-currency" value={currency} onChange={e => setCurrency(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("procurement.field.category")}</Label>
              <Select value={categoryId} onValueChange={v => v !== null && setCategoryId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => (v === "__none__" ? t("procurement.none") : categories.find(c => c.id === v)?.name ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("procurement.none")}</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("procurement.field.supplier")}</Label>
              <Select value={supplierId} onValueChange={v => v !== null && setSupplierId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => (v === "__none__" ? t("procurement.none") : suppliers.find(s => s.id === v)?.name ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("procurement.none")}</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("procurement.field.assignee")}</Label>
            <Select value={assigneeMemberId} onValueChange={v => v !== null && setAssigneeMemberId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => (v === "__none__" ? t("procurement.none") : memberLabels.get(v) ?? v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("procurement.none")}</SelectItem>
                {members.map(m => (
                  <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={createProcurement.isPending || !itemName.trim()}>
              {t("procurement.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
