// Finance colleagues page: admin-managed list of internal finance actors,
// each linked to exactly one unified user (real or virtual). The create/edit
// picker sources from /account/assignable-users so both kinds are selectable;
// virtual users carry the same badge pattern used by project members.

import type {
  CreateFinanceColleagueInput,
  FinanceColleagueRow,
  FinanceColleagueStatus,
  UpdateFinanceColleagueInput,
} from "@/shared/lib/api/finance";
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
import {
  FINANCE_COLLEAGUE_STATUSES,
  useArchiveFinanceColleague,
  useCreateFinanceColleague,
  useFinanceColleagues,
  useUpdateFinanceColleague,
} from "@/shared/lib/api/finance";
import { useAssignableUsers } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

const ALL = "__all__";

export function FinanceColleaguesPage() {
  const { t } = useTranslation("finance");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FinanceColleagueRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FinanceColleagueRow | null>(null);

  const colleaguesQuery = useFinanceColleagues({
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(statusFilter !== ALL ? { status: statusFilter as FinanceColleagueStatus } : {}),
    page,
  });
  const archiveColleague = useArchiveFinanceColleague();

  const rows = colleaguesQuery.data?.data ?? [];
  const meta = colleaguesQuery.data?.meta;

  const statusLabel = (status: FinanceColleagueStatus) =>
    status === "active" ? t("colleagues.statusActive") : t("colleagues.statusArchived");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t("colleagues.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("colleagues.description")}</p>
      </div>

      {colleaguesQuery.error && (
        <ErrorBanner message={errorMessage(colleaguesQuery.error, t("common.error.loadFailed"))} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("colleagues.searchPlaceholder")}
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
              label: t("colleagues.field.status"),
              mode: "single",
              defaultValue: ALL,
              value: statusFilter,
              onChange: (value) => {
                setStatusFilter(value ?? ALL);
                setPage(1);
              },
              options: FINANCE_COLLEAGUE_STATUSES.map(status => ({
                value: status,
                label: statusLabel(status),
              })),
            },
          ]}
        />

        <span className="text-sm text-muted-foreground">
          {t("colleagues.totalCount", { count: meta?.total ?? 0 })}
        </span>

        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t("colleagues.create")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colleagues.col.user")}</TableHead>
              <TableHead>{t("colleagues.col.code")}</TableHead>
              <TableHead>{t("colleagues.col.title")}</TableHead>
              <TableHead>{t("colleagues.col.department")}</TableHead>
              <TableHead>{t("colleagues.col.status")}</TableHead>
              <TableHead>{t("colleagues.col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={colleaguesQuery.isLoading}>
            {colleaguesQuery.isLoading
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
                        {t("colleagues.noResults")}
                      </TableCell>
                    </TableRow>
                  )
                : rows.map(colleague => (
                    <TableRow key={colleague.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{colleague.user.name}</span>
                          <span className="text-muted-foreground">
                            {`(${colleague.user.username})`}
                          </span>
                          {colleague.user.isVirtual && (
                            <Badge variant="outline" className="text-xs">
                              {t("colleagues.virtualBadge")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{colleague.code || "—"}</TableCell>
                      <TableCell>{colleague.title || "—"}</TableCell>
                      <TableCell>{colleague.department || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={colleague.status === "active" ? "default" : "secondary"}>
                          {statusLabel(colleague.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => setEditTarget(colleague)}>
                            {t("common.edit")}
                          </Button>
                          {colleague.status === "active" && (
                            <Button
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setArchiveTarget(colleague)}
                            >
                              {t("colleagues.archive")}
                            </Button>
                          )}
                        </div>
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
        <ColleagueDialog
          mode="create"
          open
          onOpenChange={open => !open && setCreateOpen(false)}
        />
      )}
      {editTarget && (
        <ColleagueDialog
          mode="edit"
          colleague={editTarget}
          open
          onOpenChange={open => !open && setEditTarget(null)}
        />
      )}

      <ConfirmDeleteDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setArchiveTarget(null);
        }}
        title={t("colleagues.archiveTitle")}
        description={t("colleagues.archiveConfirm", { name: archiveTarget?.user.name })}
        confirmLabel={t("colleagues.archive")}
        pending={archiveColleague.isPending}
        onConfirm={() => {
          if (archiveTarget) {
            archiveColleague.mutate(archiveTarget.id, {
              onSuccess: () => {
                toast.success(t("colleagues.toast.archived"));
                setArchiveTarget(null);
              },
              onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
            });
          }
        }}
      />
    </div>
  );
}

interface ColleagueDialogProps {
  readonly mode: "create" | "edit";
  readonly colleague?: FinanceColleagueRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function ColleagueDialog({ mode, colleague, open, onOpenChange }: ColleagueDialogProps) {
  const { t } = useTranslation("finance");
  const createColleague = useCreateFinanceColleague();
  const updateColleague = useUpdateFinanceColleague();
  const usersQuery = useAssignableUsers();

  const [userId, setUserId] = useState(colleague?.userId ?? "");
  const [code, setCode] = useState(colleague?.code ?? "");
  const [title, setTitle] = useState(colleague?.title ?? "");
  const [department, setDepartment] = useState(colleague?.department ?? "");
  const [notes, setNotes] = useState(colleague?.notes ?? "");
  const [status, setStatus] = useState<FinanceColleagueStatus>(colleague?.status ?? "active");

  const users = usersQuery.data ?? [];
  const pending = createColleague.isPending || updateColleague.isPending;
  const mutationError = mode === "create" ? createColleague.error : updateColleague.error;

  const close = () => onOpenChange(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId || pending)
      return;
    if (mode === "create") {
      const body: CreateFinanceColleagueInput = {
        userId,
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(department.trim() ? { department: department.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      createColleague.mutate(body, {
        onSuccess: () => {
          toast.success(t("colleagues.toast.created"));
          close();
        },
        onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
      });
      return;
    }
    // Edit sends every editable field; the backend accepts empty strings,
    // which the list renders the same as null ("—").
    const body: UpdateFinanceColleagueInput = {
      userId,
      code: code.trim(),
      title: title.trim(),
      department: department.trim(),
      notes: notes.trim(),
      status,
    };
    updateColleague.mutate({ id: colleague!.id, ...body }, {
      onSuccess: () => {
        toast.success(t("colleagues.toast.updated"));
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
              {mode === "create" ? t("colleagues.createTitle") : t("colleagues.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("colleagues.createDescription") : t("colleagues.editDescription")}
            </DialogDescription>
          </DialogHeader>

          {mutationError && (
            <ErrorBanner message={errorMessage(mutationError, t("common.error.operationFailed"))} />
          )}

          <div className="space-y-1.5">
            <Label>{t("colleagues.field.user")}</Label>
            <Select value={userId} onValueChange={v => v !== null && setUserId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("colleagues.selectUser")}>
                  {(v: string) => users.find(u => u.id === v)?.name ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {users.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="flex items-center gap-2">
                      {`${u.name} (${u.username})`}
                      {u.isVirtual && (
                        <Badge variant="outline" className="text-xs">
                          {t("colleagues.virtualBadge")}
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="colleague-code">{t("colleagues.field.code")}</Label>
              <Input
                id="colleague-code"
                maxLength={100}
                value={code}
                onChange={e => setCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="colleague-title">{t("colleagues.field.title")}</Label>
              <Input
                id="colleague-title"
                maxLength={200}
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="colleague-department">{t("colleagues.field.department")}</Label>
            <Input
              id="colleague-department"
              maxLength={200}
              value={department}
              onChange={e => setDepartment(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="colleague-notes">{t("colleagues.field.notes")}</Label>
            <Input
              id="colleague-notes"
              maxLength={2000}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {mode === "edit" && (
            <div className="space-y-1.5">
              <Label>{t("colleagues.field.status")}</Label>
              <Select
                value={status}
                onValueChange={v => v !== null && setStatus(v as FinanceColleagueStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: FinanceColleagueStatus) =>
                      v === "active" ? t("colleagues.statusActive") : t("colleagues.statusArchived")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FINANCE_COLLEAGUE_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {s === "active" ? t("colleagues.statusActive") : t("colleagues.statusArchived")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !userId}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
