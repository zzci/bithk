// Procurement tab: filterable list + create dialog + per-row status change
// and delete. Mounted only when the caller is pm or has canViewProcurement,
// so it assumes read access; create/delete/status are pm affordances.

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
import {
  PROCUREMENT_STATUSES,
  useChangeProcurementStatus,
  useCreateProcurement,
  useDeleteProcurement,
  useProcurements,
} from "@/shared/lib/api/procurement";
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
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementRow | null>(null);

  const procurementsQuery = useProcurements(projectId, {
    status: statusFilter === "__all__" ? undefined : (statusFilter as ProcurementStatus),
    page,
  });
  const changeStatus = useChangeProcurementStatus();
  const deleteProcurement = useDeleteProcurement();

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const rows = procurementsQuery.data?.data ?? [];
  const meta = procurementsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const memberName = (id: string | null) =>
    id ? memberLabels.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;

  const formatAmount = (row: ProcurementRow) => {
    if (row.amount === null)
      return "—";
    return row.currency ? `${row.amount} ${row.currency}` : String(row.amount);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v === null)
              return;
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue>
              {(v: string) => (v === "__all__" ? t("procurement.allStatuses") : t(`procurement.status.${v}` as const))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("procurement.allStatuses")}</SelectItem>
            {PROCUREMENT_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{t(`procurement.status.${s}` as const)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("procurement.create")}
          </Button>
        )}
      </div>

      {procurementsQuery.error && <ErrorBanner message={errorMessage(procurementsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("procurement.col.itemName")}</TableHead>
              <TableHead>{t("procurement.col.status")}</TableHead>
              <TableHead>{t("procurement.col.amount")}</TableHead>
              <TableHead>{t("procurement.col.supplier")}</TableHead>
              <TableHead>{t("procurement.col.assignee")}</TableHead>
              {canManage && <TableHead>{t("procurement.col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {procurementsQuery.isLoading
              ? <TableRow><TableCell colSpan={canManage ? 6 : 5} className="h-24 text-center text-muted-foreground">{t("procurement.loading")}</TableCell></TableRow>
              : rows.length === 0
                ? <TableRow><TableCell colSpan={canManage ? 6 : 5} className="h-24 text-center text-muted-foreground">{t("procurement.empty")}</TableCell></TableRow>
                : rows.map(row => (
                    <TableRow key={row.id}>
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
                      <TableCell className="text-sm">{memberName(row.supplierMemberId)}</TableCell>
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
          <div className="flex items-center justify-between border-t px-3 py-2">
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
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CreateProcurementDialog({ projectId, members, memberLabels, open, onOpenChange }: CreateProcurementDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createProcurement = useCreateProcurement();
  const [itemName, setItemName] = useState("");
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [supplierMemberId, setSupplierMemberId] = useState("__none__");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");

  const reset = () => {
    setItemName("");
    setTitle("");
    setQuantity("");
    setAmount("");
    setCurrency("");
    setSupplierMemberId("__none__");
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
      ...(supplierMemberId !== "__none__" ? { supplierMemberId } : {}),
      ...(assigneeMemberId !== "__none__" ? { assigneeMemberId } : {}),
    };
    createProcurement.mutate({ projectId, ...body }, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  };

  const memberSelect = (
    value: string,
    onChange: (v: string) => void,
    label: string,
  ) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={v => v !== null && onChange(v)}>
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
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
            {memberSelect(supplierMemberId, setSupplierMemberId, t("procurement.field.supplier"))}
            {memberSelect(assigneeMemberId, setAssigneeMemberId, t("procurement.field.assignee"))}
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
