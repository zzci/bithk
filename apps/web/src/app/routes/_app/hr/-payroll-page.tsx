// HR payroll page: admin-managed per-colleague monthly payroll records.
// Amounts are integers in the currency's minor unit, shown raw with the
// currency code (procurement convention). Pending records can be edited,
// marked paid (one-way), or deleted; paid records are immutable history.

import type {
  CreateHrPayrollInput,
  HrPayrollRow,
  HrPayrollStatus,
} from "@/shared/lib/api/hr-payroll";
import { CalendarPlus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { MoneyInput } from "@/shared/components/money-input";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { useHrColleagues } from "@/shared/lib/api/hr";
import {
  HR_PAYROLL_CURRENCIES,
  HR_PAYROLL_STATUSES,
  useCreateHrPayrollRecord,
  useDeleteHrPayrollRecord,
  useGeneratePayroll,
  useHrPayrollRecords,
  useUpdateHrPayrollRecord,
} from "@/shared/lib/api/hr-payroll";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime, formatMoney } from "@/shared/lib/format";
import { useAuthStore } from "@/shared/stores/auth";

const ALL = "__all__";

export function HrPayrollPage() {
  const { t } = useTranslation("hr");
  // Only admins may mark records paid or run the monthly generation; the
  // backend 403s non-admins, so the UI hides those actions rather than
  // letting them fail.
  const isAdmin = useAuthStore(s => s.user?.role === "admin");
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [colleagueFilter, setColleagueFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<HrPayrollRow | null>(null);
  const [payTarget, setPayTarget] = useState<HrPayrollRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HrPayrollRow | null>(null);

  // All colleagues (including disabled) so historical records stay filterable.
  const colleaguesQuery = useHrColleagues({ limit: 100 });
  const colleagues = colleaguesQuery.data?.data ?? [];

  const payrollQuery = useHrPayrollRecords({
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(statusFilter !== ALL ? { status: statusFilter as HrPayrollStatus } : {}),
    ...(colleagueFilter !== ALL ? { colleagueId: colleagueFilter } : {}),
    page,
  });
  const updateRecord = useUpdateHrPayrollRecord();
  const deleteRecord = useDeleteHrPayrollRecord();

  const rows = payrollQuery.data?.data ?? [];
  const meta = payrollQuery.data?.meta;
  const totals = meta?.totals ?? [];

  const statusLabel = (status: HrPayrollStatus) => t(`payroll.status.${status}`);
  const amount = (value: number, currency: string) => `${formatMoney(value)} ${currency}`;

  return (
    <div className="space-y-4">
      {payrollQuery.error && (
        <ErrorBanner message={errorMessage(payrollQuery.error, t("common.error.loadFailed"))} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <Input
            type="month"
            aria-label={t("payroll.field.period")}
            value={periodFilter}
            onChange={(e) => {
              setPeriodFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("payroll.field.status"),
              mode: "single",
              defaultValue: ALL,
              value: statusFilter,
              onChange: (value) => {
                setStatusFilter(value ?? ALL);
                setPage(1);
              },
              options: HR_PAYROLL_STATUSES.map(status => ({
                value: status,
                label: statusLabel(status),
              })),
            },
          ]}
        />

        <div className="w-56">
          <Select
            value={colleagueFilter}
            onValueChange={(value) => {
              if (value !== null) {
                setColleagueFilter(value);
                setPage(1);
              }
            }}
          >
            <SelectTrigger className="w-full" aria-label={t("payroll.filterColleague")}>
              <SelectValue>
                {(value: string) =>
                  value === ALL
                    ? t("payroll.allColleagues")
                    : colleagues.find(c => c.id === value)?.user.name ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("payroll.allColleagues")}</SelectItem>
              {colleagues.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {`${c.user.name} (${c.user.username})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-sm text-muted-foreground">
          {t("payroll.totalCount", { count: meta?.total ?? 0 })}
        </span>

        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => setGenerateOpen(true)}>
              <CalendarPlus className="mr-1 size-4" />
              {t("payroll.generate")}
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("payroll.create")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.col.colleague")}</TableHead>
              <TableHead>{t("payroll.col.period")}</TableHead>
              <TableHead className="text-right">{t("payroll.col.baseSalary")}</TableHead>
              <TableHead className="text-right">{t("payroll.col.bonus")}</TableHead>
              <TableHead className="text-right">{t("payroll.col.deduction")}</TableHead>
              <TableHead className="text-right">{t("payroll.col.netAmount")}</TableHead>
              <TableHead>{t("payroll.col.status")}</TableHead>
              <TableHead>{t("payroll.col.paidAt")}</TableHead>
              <TableHead>{t("payroll.col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={payrollQuery.isLoading}>
            {payrollQuery.isLoading
              ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                )
              : rows.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                        {t("payroll.noResults")}
                      </TableCell>
                    </TableRow>
                  )
                : rows.map(record => (
                    <TableRow key={record.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{record.colleague.name}</span>
                          <span className="text-muted-foreground">
                            {`(${record.colleague.username})`}
                          </span>
                          {record.colleague.isVirtual && (
                            <Badge variant="outline" className="text-xs">
                              {t("colleagues.virtualBadge")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{record.period}</TableCell>
                      <TableCell className="text-right tabular-nums">{amount(record.baseSalary, record.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{amount(record.bonus, record.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{amount(record.deduction, record.currency)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{amount(record.netAmount, record.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={record.status === "paid" ? "default" : "secondary"}>
                          {statusLabel(record.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {record.paidAt ? formatDateTime(record.paidAt) : "—"}
                      </TableCell>
                      <TableCell>
                        {record.status === "pending"
                          ? (
                              <div className="flex gap-1">
                                {isAdmin && (
                                  <Button variant="ghost" onClick={() => setPayTarget(record)}>
                                    {t("payroll.markPaid")}
                                  </Button>
                                )}
                                <Button variant="ghost" onClick={() => setEditTarget(record)}>
                                  {t("common.edit")}
                                </Button>
                                <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(record)}>
                                  {t("common.delete")}
                                </Button>
                              </div>
                            )
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
          {totals.length > 0 && (
            <TableFooter>
              {totals.map(total => (
                <TableRow key={total.currency}>
                  <TableCell colSpan={5} className="text-right font-medium">
                    {`${t("payroll.summaryLabel")} · ${total.currency}`}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {`${formatMoney(total.net)} ${total.currency}`}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              ))}
            </TableFooter>
          )}
        </Table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t("common.prev")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {page}
            {" / "}
            {meta.totalPages}
          </span>
          <Button variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      )}

      {createOpen && (
        <PayrollDialog
          mode="create"
          open
          onOpenChange={open => !open && setCreateOpen(false)}
        />
      )}
      {isAdmin && generateOpen && (
        <GeneratePayrollDialog
          open
          onOpenChange={open => !open && setGenerateOpen(false)}
        />
      )}
      {editTarget && (
        <PayrollDialog
          mode="edit"
          record={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}

      <ConfirmDeleteDialog
        open={payTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setPayTarget(null);
        }}
        title={t("payroll.markPaidTitle")}
        description={t("payroll.markPaidConfirm", {
          name: payTarget?.colleague.name,
          period: payTarget?.period,
          amount: payTarget ? amount(payTarget.netAmount, payTarget.currency) : "",
        })}
        confirmLabel={t("payroll.markPaid")}
        pending={updateRecord.isPending}
        onConfirm={() => {
          if (payTarget) {
            updateRecord.mutate({ id: payTarget.id, status: "paid" }, {
              onSuccess: () => {
                toast.success(t("payroll.toast.paid"));
                setPayTarget(null);
              },
              onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
            });
          }
        }}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("payroll.deleteTitle")}
        description={t("payroll.deleteConfirm", {
          name: deleteTarget?.colleague.name,
          period: deleteTarget?.period,
        })}
        pending={deleteRecord.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteRecord.mutate(deleteTarget.id, {
              onSuccess: () => {
                toast.success(t("payroll.toast.deleted"));
                setDeleteTarget(null);
              },
              onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
            });
          }
        }}
      />
    </div>
  );
}

interface PayrollDialogProps {
  readonly mode: "create" | "edit";
  readonly record?: HrPayrollRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function PayrollDialog({ mode, record, open, onOpenChange }: PayrollDialogProps) {
  const { t } = useTranslation("hr");
  const createRecord = useCreateHrPayrollRecord();
  const updateRecord = useUpdateHrPayrollRecord();
  // Recipient picker: active colleagues only (the backend enforces the same).
  const colleaguesQuery = useHrColleagues({ status: "active", limit: 100 });

  const [colleagueId, setColleagueId] = useState(record?.colleagueId ?? "");
  const [period, setPeriod] = useState(record?.period ?? "");
  const [baseSalary, setBaseSalary] = useState<number | null>(record ? record.baseSalary : null);
  const [bonus, setBonus] = useState<number | null>(record ? record.bonus : 0);
  const [deduction, setDeduction] = useState<number | null>(record ? record.deduction : 0);
  const [currency, setCurrency] = useState(record?.currency ?? "CNY");
  const [notes, setNotes] = useState(record?.notes ?? "");

  const colleagues = colleaguesQuery.data?.data ?? [];
  const pending = createRecord.isPending || updateRecord.isPending;
  const mutationError = mode === "create" ? createRecord.error : updateRecord.error;

  const valid = Boolean(colleagueId && period && baseSalary !== null && bonus !== null && deduction !== null);

  const close = () => onOpenChange(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || pending)
      return;
    if (mode === "create") {
      const body: CreateHrPayrollInput = {
        colleagueId,
        period,
        baseSalary: baseSalary!,
        bonus: bonus!,
        deduction: deduction!,
        currency,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      createRecord.mutate(body, {
        onSuccess: () => {
          toast.success(t("payroll.toast.created"));
          close();
        },
        onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
      });
      return;
    }
    updateRecord.mutate({
      id: record!.id,
      colleagueId,
      period,
      baseSalary: baseSalary!,
      bonus: bonus!,
      deduction: deduction!,
      currency,
      notes: notes.trim(),
    }, {
      onSuccess: () => {
        toast.success(t("payroll.toast.updated"));
        close();
      },
      onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? t("payroll.createTitle") : t("payroll.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("payroll.createDescription") : t("payroll.editDescription")}
            </DialogDescription>
          </DialogHeader>

          {mutationError && (
            <ErrorBanner message={errorMessage(mutationError, t("common.error.operationFailed"))} />
          )}

          <div className="space-y-1.5">
            <Label>{t("payroll.field.colleague")}</Label>
            <Select value={colleagueId} onValueChange={v => v !== null && setColleagueId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("payroll.selectColleague")}>
                  {(v: string) => colleagues.find(c => c.id === v)?.user.name ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {colleagues.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {`${c.user.name} (${c.user.username})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="payroll-period">{t("payroll.field.period")}</Label>
              <Input
                id="payroll-period"
                type="month"
                value={period}
                onChange={e => setPeriod(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("payroll.field.currency")}</Label>
              <Select value={currency} onValueChange={v => v !== null && setCurrency(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HR_PAYROLL_CURRENCIES.map(code => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="payroll-base">{t("payroll.field.baseSalary")}</Label>
              <MoneyInput id="payroll-base" value={baseSalary} onChange={setBaseSalary} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payroll-bonus">{t("payroll.field.bonus")}</Label>
              <MoneyInput id="payroll-bonus" value={bonus} onChange={setBonus} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payroll-deduction">{t("payroll.field.deduction")}</Label>
              <MoneyInput id="payroll-deduction" value={deduction} onChange={setDeduction} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payroll-notes">{t("payroll.field.notes")}</Label>
            <Textarea
              id="payroll-notes"
              maxLength={2000}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface GeneratePayrollDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

// Admin-only one-click monthly generation. Picks a YYYY-MM month and POSTs it;
// the backend creates a pending record for every active colleague with a
// configured salary that lacks one for the period, then reports the counts.
function GeneratePayrollDialog({ open, onOpenChange }: GeneratePayrollDialogProps) {
  const { t } = useTranslation("hr");
  const generate = useGeneratePayroll();
  const [period, setPeriod] = useState("");

  const close = () => onOpenChange(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!period || generate.isPending)
      return;
    generate.mutate({ period }, {
      onSuccess: (result) => {
        toast.success(t("payroll.generateToast", {
          created: result.created,
          skipped: result.skipped,
        }));
        close();
      },
      onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("payroll.generateTitle")}</DialogTitle>
            <DialogDescription>{t("payroll.generateDescription")}</DialogDescription>
          </DialogHeader>

          {generate.error && (
            <ErrorBanner message={errorMessage(generate.error, t("common.error.operationFailed"))} />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="payroll-generate-period">{t("payroll.generatePeriod")}</Label>
            <Input
              id="payroll-generate-period"
              type="month"
              value={period}
              onChange={e => setPeriod(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={generate.isPending || !period}>
              {t("payroll.generateSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
