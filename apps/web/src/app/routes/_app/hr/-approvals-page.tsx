// HR approvals page: admin-managed approval requests filed for colleagues.
// Pending requests can be edited, decided (approved/rejected, exactly once),
// or withdrawn; decided records are immutable history.

import type {
  CreateHrApprovalInput,
  HrApprovalRow,
  HrApprovalStatus,
  HrApprovalType,
} from "@/shared/lib/api/hr-approvals";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
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
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useHrColleagues } from "@/shared/lib/api/hr";
import {
  HR_APPROVAL_STATUSES,
  HR_APPROVAL_TYPES,
  useCreateHrApproval,
  useDecideHrApproval,
  useDeleteHrApproval,
  useHrApprovals,
  useUpdateHrApproval,
} from "@/shared/lib/api/hr-approvals";
import { errorMessage } from "@/shared/lib/errors";

const ALL = "__all__";

export function HrApprovalsPage() {
  const { t } = useTranslation("hr");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<HrApprovalRow | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ row: HrApprovalRow; status: "approved" | "rejected" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HrApprovalRow | null>(null);

  const approvalsQuery = useHrApprovals({
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(statusFilter !== ALL ? { status: statusFilter as HrApprovalStatus } : {}),
    ...(typeFilter !== ALL ? { type: typeFilter as HrApprovalType } : {}),
    page,
  });
  const deleteApproval = useDeleteHrApproval();

  const rows = approvalsQuery.data?.data ?? [];
  const meta = approvalsQuery.data?.meta;

  const statusLabel = (status: HrApprovalStatus) => t(`approvals.status.${status}`);
  const typeLabel = (type: HrApprovalType) => t(`approvals.type.${type}`);
  const statusVariant = (status: HrApprovalStatus) =>
    status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t("approvals.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("approvals.description")}</p>
      </div>

      {approvalsQuery.error && (
        <ErrorBanner message={errorMessage(approvalsQuery.error, t("common.error.loadFailed"))} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("approvals.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>

        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("approvals.field.status"),
              mode: "single",
              defaultValue: ALL,
              value: statusFilter,
              onChange: (value) => {
                setStatusFilter(value ?? ALL);
                setPage(1);
              },
              options: HR_APPROVAL_STATUSES.map(status => ({
                value: status,
                label: statusLabel(status),
              })),
            },
            {
              key: "type",
              label: t("approvals.field.type"),
              mode: "single",
              defaultValue: ALL,
              value: typeFilter,
              onChange: (value) => {
                setTypeFilter(value ?? ALL);
                setPage(1);
              },
              options: HR_APPROVAL_TYPES.map(type => ({
                value: type,
                label: typeLabel(type),
              })),
            },
          ]}
        />

        <span className="text-sm text-muted-foreground">
          {t("approvals.totalCount", { count: meta?.total ?? 0 })}
        </span>

        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t("approvals.create")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("approvals.col.applicant")}</TableHead>
              <TableHead>{t("approvals.col.type")}</TableHead>
              <TableHead>{t("approvals.col.title")}</TableHead>
              <TableHead>{t("approvals.col.status")}</TableHead>
              <TableHead>{t("approvals.col.decision")}</TableHead>
              <TableHead>{t("approvals.col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={approvalsQuery.isLoading}>
            {approvalsQuery.isLoading
              ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                )
              : rows.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        {t("approvals.noResults")}
                      </TableCell>
                    </TableRow>
                  )
                : rows.map(approval => (
                    <TableRow key={approval.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{approval.applicant.name}</span>
                          <span className="text-muted-foreground">
                            {`(${approval.applicant.username})`}
                          </span>
                          {approval.applicant.isVirtual && (
                            <Badge variant="outline" className="text-xs">
                              {t("colleagues.virtualBadge")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{typeLabel(approval.type)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{approval.title}</div>
                        {approval.reason && (
                          <div className="max-w-72 truncate text-xs text-muted-foreground">{approval.reason}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(approval.status)}>
                          {statusLabel(approval.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {approval.status === "pending"
                          ? "—"
                          : (
                              <div>
                                <div className="text-sm">{approval.decidedByName ?? "—"}</div>
                                {approval.decisionNote && (
                                  <div className="max-w-56 truncate text-xs text-muted-foreground">{approval.decisionNote}</div>
                                )}
                              </div>
                            )}
                      </TableCell>
                      <TableCell>
                        {approval.status === "pending"
                          ? (
                              <div className="flex gap-1">
                                <Button variant="ghost" onClick={() => setDecisionTarget({ row: approval, status: "approved" })}>
                                  {t("approvals.approve")}
                                </Button>
                                <Button variant="ghost" className="text-destructive" onClick={() => setDecisionTarget({ row: approval, status: "rejected" })}>
                                  {t("approvals.reject")}
                                </Button>
                                <Button variant="ghost" onClick={() => setEditTarget(approval)}>
                                  {t("common.edit")}
                                </Button>
                                <Button variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(approval)}>
                                  {t("common.delete")}
                                </Button>
                              </div>
                            )
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
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
        <ApprovalDialog
          mode="create"
          open
          onOpenChange={open => !open && setCreateOpen(false)}
        />
      )}
      {editTarget && (
        <ApprovalDialog
          mode="edit"
          approval={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}
      {decisionTarget && (
        <DecisionDialog
          target={decisionTarget.row}
          status={decisionTarget.status}
          open
          onOpenChange={open => !open && setDecisionTarget(null)}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("approvals.deleteTitle")}
        description={t("approvals.deleteConfirm", { title: deleteTarget?.title })}
        pending={deleteApproval.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteApproval.mutate(deleteTarget.id, {
              onSuccess: () => {
                toast.success(t("approvals.toast.deleted"));
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

interface ApprovalDialogProps {
  readonly mode: "create" | "edit";
  readonly approval?: HrApprovalRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function ApprovalDialog({ mode, approval, open, onOpenChange }: ApprovalDialogProps) {
  const { t } = useTranslation("hr");
  const createApproval = useCreateHrApproval();
  const updateApproval = useUpdateHrApproval();
  // Applicant picker: active colleagues only (the backend enforces the same).
  const colleaguesQuery = useHrColleagues({ status: "active", limit: 100 });

  const [colleagueId, setColleagueId] = useState(approval?.colleagueId ?? "");
  const [type, setType] = useState<HrApprovalType>(approval?.type ?? "leave");
  const [title, setTitle] = useState(approval?.title ?? "");
  const [reason, setReason] = useState(approval?.reason ?? "");

  const colleagues = colleaguesQuery.data?.data ?? [];
  const pending = createApproval.isPending || updateApproval.isPending;
  const mutationError = mode === "create" ? createApproval.error : updateApproval.error;

  const close = () => onOpenChange(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!colleagueId || !title.trim() || pending)
      return;
    if (mode === "create") {
      const body: CreateHrApprovalInput = {
        colleagueId,
        type,
        title: title.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      createApproval.mutate(body, {
        onSuccess: () => {
          toast.success(t("approvals.toast.created"));
          close();
        },
        onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
      });
      return;
    }
    updateApproval.mutate({
      id: approval!.id,
      colleagueId,
      type,
      title: title.trim(),
      reason: reason.trim(),
    }, {
      onSuccess: () => {
        toast.success(t("approvals.toast.updated"));
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
              {mode === "create" ? t("approvals.createTitle") : t("approvals.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("approvals.createDescription") : t("approvals.editDescription")}
            </DialogDescription>
          </DialogHeader>

          {mutationError && (
            <ErrorBanner message={errorMessage(mutationError, t("common.error.operationFailed"))} />
          )}

          <div className="space-y-1.5">
            <Label>{t("approvals.field.applicant")}</Label>
            <Select value={colleagueId} onValueChange={v => v !== null && setColleagueId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("approvals.selectColleague")}>
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

          <div className="space-y-1.5">
            <Label>{t("approvals.field.type")}</Label>
            <Select value={type} onValueChange={v => v !== null && setType(v as HrApprovalType)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: HrApprovalType) => t(`approvals.type.${v}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HR_APPROVAL_TYPES.map(value => (
                  <SelectItem key={value} value={value}>
                    {t(`approvals.type.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="approval-title">{t("approvals.field.title")}</Label>
            <Input
              id="approval-title"
              maxLength={200}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="approval-reason">{t("approvals.field.reason")}</Label>
            <Input
              id="approval-reason"
              maxLength={2000}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !colleagueId || !title.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DecisionDialogProps {
  readonly target: HrApprovalRow;
  readonly status: "approved" | "rejected";
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

// Deciding is one-way, so it gets an explicit dialog (with an optional note)
// instead of an inline toggle.
function DecisionDialog({ target, status, open, onOpenChange }: DecisionDialogProps) {
  const { t } = useTranslation("hr");
  const decideApproval = useDecideHrApproval();
  const [note, setNote] = useState("");

  const close = () => onOpenChange(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (decideApproval.isPending)
      return;
    decideApproval.mutate({
      id: target.id,
      status,
      ...(note.trim() ? { note: note.trim() } : {}),
    }, {
      onSuccess: () => {
        toast.success(t(status === "approved" ? "approvals.toast.approved" : "approvals.toast.rejected"));
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
              {status === "approved" ? t("approvals.approveTitle") : t("approvals.rejectTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("approvals.decisionConfirm", { title: target.title, name: target.applicant.name })}
            </DialogDescription>
          </DialogHeader>

          {decideApproval.error && (
            <ErrorBanner message={errorMessage(decideApproval.error, t("common.error.operationFailed"))} />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="decision-note">{t("approvals.field.note")}</Label>
            <Input
              id="decision-note"
              maxLength={2000}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={status === "rejected" ? "destructive" : "default"}
              disabled={decideApproval.isPending}
            >
              {status === "approved" ? t("approvals.approve") : t("approvals.reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
