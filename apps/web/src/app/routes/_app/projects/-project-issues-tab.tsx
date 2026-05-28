// Issues (work orders) tab. A 1:1 port of the access issue list
// (`portal/issues/index.lazy.tsx`): a flat table with debounced title search,
// status + priority filter dropdowns, pagination, and a row click that opens the
// project-scoped issue drawer route. Adapted only for project nesting — the
// assignee picker lists project members and the create payload carries
// `assigneeMemberId`. A single pin toggle is kept as an isolated row affordance
// because the project pinned-home surface depends on it.

import type {
  CreateProjectIssueInput,
  ProjectIssueRow,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  CircleUser,
  Pin,
  PinOff,
  Plus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
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
import { useToggleIssuePin } from "@/shared/lib/api/pins";
import { useCreateProjectIssue, useProjectIssues } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";
import { useDeleteProjectIssue } from "./-project-issue-hooks";
import {
  priorityKey,
  priorityVariants,
  statusKey,
  statusVariants,
} from "./-project-issue-panel";

interface ProjectIssuesTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  /** Holds `issue.manage` (admins included). Combined with the creator check to gate delete + pin. */
  readonly canManage?: boolean;
}

export function ProjectIssuesTab({ projectId, members, userNames, canManage = false }: ProjectIssuesTabProps) {
  const { t } = useTranslation(["issues", "projects", "common"]);
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === "admin";

  // The drawer is a nested route; read the active issueId (if any) so the open
  // row stays highlighted while its drawer overlays the list.
  const activeParams = useParams({ strict: false }) as { readonly issueId?: string };
  const activeIssueId = activeParams.issueId;

  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [priorityFilter, setPriorityFilter] = useState("__all__");
  const [page, setPage] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState<ProjectIssueRow | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const q = debouncedSearch || undefined;
  const status = statusFilter === "__all__" ? undefined : (statusFilter as ProjectIssueRow["status"]);
  const priority = priorityFilter === "__all__" ? undefined : (priorityFilter as ProjectIssueRow["priority"]);
  const issuesQuery = useProjectIssues(projectId, { q, status, priority, page, limit: 20 });
  const deleteIssue = useDeleteProjectIssue();

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);

  const issues = issuesQuery.data?.data ?? [];
  const meta = issuesQuery.data?.meta ?? { total: 0, page: 1, limit: 20 };
  const totalPages = Math.ceil(meta.total / meta.limit);
  const loadError = issuesQuery.error;

  const canDelete = (issue: ProjectIssueRow) => isAdmin || canManage || issue.creatorId === user?.id;
  const canPin = (issue: ProjectIssueRow) => canManage || issue.creatorId === user?.id;

  const assigneeLabel = (issue: ProjectIssueRow) =>
    issue.assigneeMemberId
      ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
      : null;

  const openIssue = (issueId: string) => {
    void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId } });
  };

  const confirmDelete = () => {
    if (!deleteConfirm)
      return;
    deleteIssue.mutate({ projectId, issueId: deleteConfirm.id }, {
      onSuccess: () => {
        setDeleteConfirm(null);
        if (activeIssueId === deleteConfirm.id)
          void navigate({ to: "/projects/$projectId", params: { projectId } });
      },
      onError: (err) => {
        toast.error(errorMessage(err, t("common:common.error.deleteFailed")));
        setDeleteConfirm(null);
      },
    });
  };

  const colCount = isAdmin ? 6 : 5;

  return (
    <div className="space-y-4">
      {/* Toolbar: search + status + priority filters, create on the right. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v === null)
              return;
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label={t("col.status")}>
            <SelectValue>
              {(v: string) => ({
                __all__: t("allStatuses"),
                open: t("statusOpen"),
                in_progress: t("statusInProgress"),
                done: t("statusDone"),
                cancelled: t("statusCancelled"),
              }[v])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("allStatuses")}</SelectItem>
            <SelectItem value="open">{t("statusOpen")}</SelectItem>
            <SelectItem value="in_progress">{t("statusInProgress")}</SelectItem>
            <SelectItem value="done">{t("statusDone")}</SelectItem>
            <SelectItem value="cancelled">{t("statusCancelled")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={priorityFilter}
          onValueChange={(v) => {
            if (v === null)
              return;
            setPriorityFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label={t("col.priority")}>
            <SelectValue>
              {(v: string) => ({
                __all__: t("allPriorities"),
                low: t("priorityLow"),
                medium: t("priorityMedium"),
                high: t("priorityHigh"),
                urgent: t("priorityUrgent"),
              }[v])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("allPriorities")}</SelectItem>
            <SelectItem value="low">{t("priorityLow")}</SelectItem>
            <SelectItem value="medium">{t("priorityMedium")}</SelectItem>
            <SelectItem value="high">{t("priorityHigh")}</SelectItem>
            <SelectItem value="urgent">{t("priorityUrgent")}</SelectItem>
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t("create")}
        </Button>
      </div>

      {loadError && <ErrorBanner message={errorMessage(loadError, t("common:common.error.loadFailed"))} />}

      <ConfirmDeleteDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteConfirm(null);
        }}
        title={t("deleteTitle")}
        description={t("deleteConfirm", { title: deleteConfirm?.title })}
        onConfirm={confirmDelete}
      />

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.title")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead>{t("col.priority")}</TableHead>
              <TableHead>{t("col.assignee")}</TableHead>
              {isAdmin && <TableHead>{t("col.creator")}</TableHead>}
              <TableHead>{t("col.dueDate")}</TableHead>
              <TableHead>{t("col.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issuesQuery.isLoading
              ? <TableRow><TableCell colSpan={colCount + 1} className="h-24 text-center text-muted-foreground">{t("common:common.loading")}</TableCell></TableRow>
              : issues.length === 0
                ? <TableRow><TableCell colSpan={colCount + 1} className="h-24 text-center text-muted-foreground">{t("noResults")}</TableCell></TableRow>
                : issues.map(issue => (
                    <TableRow
                      key={issue.id}
                      className={cn("cursor-pointer", activeIssueId === issue.id && "bg-muted/60")}
                      onClick={() => openIssue(issue.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{issue.title}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariants[issue.status]} className="text-xs">
                          {t(`status${statusKey(issue.status)}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={priorityVariants[issue.priority]}>
                          {t(`priority${priorityKey(issue.priority)}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {assigneeLabel(issue) ?? <span className="text-muted-foreground">{t("unassigned")}</span>}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-sm">
                          {userNames.get(issue.creatorId) ?? issue.creatorId}
                        </TableCell>
                      )}
                      <TableCell className="text-sm">{issue.dueDate ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {canPin(issue) && <IssuePinToggle projectId={projectId} issue={issue} />}
                          {canDelete(issue) && (
                            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteConfirm(issue)} title={t("common:common.delete")}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2">
            <span className="text-xs text-muted-foreground">{t("totalCount", { count: meta.total })}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <CreateIssueForm
            projectId={projectId}
            members={members}
            memberLabels={memberLabels}
            onCancel={() => setCreateOpen(false)}
            onCreated={(id) => {
              setCreateOpen(false);
              openIssue(id);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface IssuePinToggleProps {
  readonly projectId: string;
  readonly issue: ProjectIssueRow;
}

/** Ghost icon toggle that pins/unpins an issue, with success/error toasts. */
function IssuePinToggle({ projectId, issue }: IssuePinToggleProps) {
  const { t } = useTranslation(["projects", "common"]);
  const togglePin = useToggleIssuePin();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={issue.pinned}
      aria-label={t(issue.pinned ? "overview.unpinAction" : "overview.pinAction")}
      disabled={togglePin.isPending}
      onClick={() => {
        const willPin = !issue.pinned;
        togglePin.mutate({ projectId, id: issue.id, pin: willPin }, {
          onSuccess: () => toast.success(t(willPin ? "toast.issuePinned" : "toast.issueUnpinned")),
          onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
        });
      }}
    >
      {issue.pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
    </Button>
  );
}

// ── Create Issue Form (Linear-style) ──

const PRIORITY_META = {
  low: { Icon: SignalLow, tone: "text-muted-foreground", labelKey: "priorityLow" },
  medium: { Icon: SignalMedium, tone: "text-muted-foreground", labelKey: "priorityMedium" },
  high: { Icon: SignalHigh, tone: "text-amber-500", labelKey: "priorityHigh" },
  urgent: { Icon: AlertTriangle, tone: "text-destructive", labelKey: "priorityUrgent" },
} as const;

type PriorityKey = keyof typeof PRIORITY_META;
const PRIORITY_KEYS: readonly PriorityKey[] = ["low", "medium", "high", "urgent"];

const CHIP_CLASS
  = "h-7 gap-1.5 rounded-full border-dashed px-2.5 text-xs text-muted-foreground hover:text-foreground data-placeholder:text-muted-foreground";

interface CreateIssueFormProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly onCreated: (id: string) => void;
  readonly onCancel: () => void;
}

function CreateIssueForm({ projectId, members, memberLabels, onCreated, onCancel }: CreateIssueFormProps) {
  const { t } = useTranslation(["issues", "common"]);
  const createIssue = useCreateProjectIssue();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<PriorityKey>("medium");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [dueDate, setDueDate] = useState("");
  const dueDateRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!title.trim() || createIssue.isPending)
      return;
    const body: CreateProjectIssueInput = {
      title: title.trim(),
      priority,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(assigneeMemberId !== "__none__" ? { assigneeMemberId } : {}),
      ...(dueDate ? { dueDate } : {}),
    };
    createIssue.mutate({ projectId, ...body }, {
      onSuccess: created => onCreated(created.id),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const currentPriority = PRIORITY_META[priority];
  const PriorityIcon = currentPriority.Icon;

  const assigned = assigneeMemberId !== "__none__";
  const assigneeLabel = assigned
    ? memberLabels.get(assigneeMemberId) ?? assigneeMemberId
    : t("field.assignee");

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col">
      <DialogTitle className="sr-only">{t("createTitle")}</DialogTitle>
      <DialogDescription className="sr-only">{t("createDescription")}</DialogDescription>

      <div className="flex flex-col gap-1 px-4 pt-4 pb-2">
        <input
          autoFocus
          type="text"
          required
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t("field.title")}
          aria-label={t("field.title")}
          className="w-full border-none bg-transparent p-0 text-lg font-semibold tracking-tight outline-none placeholder:font-semibold placeholder:text-muted-foreground/50"
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t("field.descriptionPlaceholder")}
          aria-label={t("field.description")}
          rows={4}
          className="max-h-60 w-full resize-none border-none bg-transparent p-0 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {createIssue.error && (
        <div className="px-4 pb-2">
          <ErrorBanner message={errorMessage(createIssue.error, t("common:common.error.operationFailed"))} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4">
        <Select value={priority} onValueChange={v => v !== null && setPriority(v as PriorityKey)}>
          <SelectTrigger size="sm" className={CHIP_CLASS} aria-label={t("field.priority")}>
            <PriorityIcon className={cn("size-3.5", currentPriority.tone)} />
            <SelectValue>
              {(v: string) => t(PRIORITY_META[v as PriorityKey].labelKey)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_KEYS.map((p) => {
              const meta = PRIORITY_META[p];
              const Icon = meta.Icon;
              return (
                <SelectItem key={p} value={p}>
                  <Icon className={cn("size-3.5", meta.tone)} />
                  {t(meta.labelKey)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select value={assigneeMemberId} onValueChange={v => v !== null && setAssigneeMemberId(v)}>
          <SelectTrigger
            size="sm"
            className={cn(CHIP_CLASS, assigned && "text-foreground")}
            aria-label={t("field.assignee")}
          >
            <CircleUser className="size-3.5" />
            <span className="truncate max-w-[10rem]">{assigneeLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("unassigned")}</SelectItem>
            {members.map(m => (
              <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const el = dueDateRef.current;
              if (!el)
                return;
              if (typeof el.showPicker === "function")
                el.showPicker();
              else
                el.focus();
            }}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-input bg-transparent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              dueDate && "text-foreground",
            )}
            aria-label={t("field.dueDate")}
          >
            <CalendarDays className="size-3.5" />
            {dueDate || t("field.dueDate")}
          </button>
          <input
            ref={dueDateRef}
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full opacity-0"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-muted/40 px-4 py-2.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common:common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={createIssue.isPending || !title.trim()}>
          {t("create")}
        </Button>
      </div>
    </form>
  );
}
