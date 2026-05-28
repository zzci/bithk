// Issues (work orders) tab: a status-grouped/sectioned list (BITHK product
// taxonomy: Todo / In Progress / Completed / Cancelled). Search and create are
// the primary top actions; a clickable status-filter row and clickable section
// headers both select the active status. Each status section renders as a
// full-width header bar above its rows. Assignment is member-based; any project
// member can create a work order. A single pin toggle is kept as an isolated row
// affordance because the project pinned-home surface depends on it. The detail
// view (drawer / fullscreen) is the access-style panel and is reached by row
// click.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectIssueRow,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate, useParams } from "@tanstack/react-router";
import { CalendarDays, Pin, PinOff, Plus, Search, SignalHigh, User } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useToggleIssuePin } from "@/shared/lib/api/pins";
import { useCreateProjectIssue, useProjectIssues } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

const PRIORITY_VARIANTS: Record<IssuePriority, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};

// Restrained semantic tint for priority cues (icon color), reusing existing
// global tokens so the label/icon stays the primary signal.
const PRIORITY_TINT: Record<IssuePriority, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

const PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];

const ISSUE_STATUSES: readonly IssueStatus[] = ["open", "in_progress", "done", "cancelled"];

// Small status dot tints, reusing the same global tokens as ISSUE_STATUS_BADGE
// so the status filter chips and create dialog selector match the section colors.
const STATUS_DOT: Record<IssueStatus, string> = {
  open: "bg-warning",
  in_progress: "bg-info",
  done: "bg-success",
  cancelled: "bg-muted-foreground",
};

type StatusFilter = IssueStatus | "all";

interface ProjectIssuesTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  /** Holds `issue.manage` (admins included). Combined with the creator check to gate the pin toggle. */
  readonly canManage?: boolean;
}

export function ProjectIssuesTab({ projectId, members, userNames, canManage = false }: ProjectIssuesTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const currentUserId = useAuthStore(s => s.user?.id);

  // Backend gates issue pinning on admin || issue.manage || creator. Mirror that
  // here so the toggle never appears where a 403 would follow.
  const canPin = (issue: ProjectIssueRow) => canManage || issue.creatorId === currentUserId;

  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Selected status; "all" shows every populated section. Driven by the top
  // status-filter chips and by clicking a section header (kept in sync).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const debouncedSearch = useDebounce(search, 300);

  // The drawer is a nested route; read the active issueId (if any) so the open
  // row stays highlighted while its drawer overlays the list.
  const activeParams = useParams({ strict: false }) as { readonly issueId?: string };
  const activeIssueId = activeParams.issueId;

  // Query each status group independently with the active search term so every
  // status keeps its own total (for the filter chips and section counts),
  // regardless of which status is currently selected.
  const q = debouncedSearch || undefined;
  const openQuery = useProjectIssues(projectId, { status: "open", q });
  const inProgressQuery = useProjectIssues(projectId, { status: "in_progress", q });
  const doneQuery = useProjectIssues(projectId, { status: "done", q });
  const cancelledQuery = useProjectIssues(projectId, { status: "cancelled", q });

  const queryByStatus: Record<IssueStatus, ReturnType<typeof useProjectIssues>> = {
    open: openQuery,
    in_progress: inProgressQuery,
    done: doneQuery,
    cancelled: cancelledQuery,
  };

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);

  const countOf = (status: IssueStatus) => queryByStatus[status].data?.meta.total ?? 0;
  const totalAll = ISSUE_STATUSES.reduce((sum, s) => sum + countOf(s), 0);

  const groups = ISSUE_STATUSES.map(status => queryByStatus[status]);
  const loadError = groups.find(g => g.error)?.error;
  const isInitialLoading = groups.every(g => g.isLoading);
  const hasAnyIssue = totalAll > 0;

  const visibleStatuses: readonly IssueStatus[] = statusFilter === "all"
    ? ISSUE_STATUSES.filter(s => countOf(s) > 0)
    : [statusFilter];

  const assigneeLabel = (issue: ProjectIssueRow) =>
    issue.assigneeMemberId
      ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
      : t("issues.unassigned");

  const openIssue = (issueId: string) => {
    void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId } });
  };

  return (
    <div className="space-y-5">
      {/* Top toolbar — search and create are the primary actions. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("issues.searchPlaceholder")}
            aria-label={t("issues.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" />
          {t("issues.create")}
        </Button>
      </div>

      {/* Status filter row — clickable chips that select the active status. */}
      <div role="group" aria-label={t("issues.statusFilter")} className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={statusFilter === "all" ? "secondary" : "ghost"}
          aria-pressed={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        >
          {t("issues.allStatuses")}
          <span className="ml-1 text-xs text-muted-foreground">{totalAll}</span>
        </Button>
        {ISSUE_STATUSES.map(s => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={statusFilter === s ? "secondary" : "ghost"}
            aria-pressed={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          >
            <span aria-hidden="true" className={cn("size-2 rounded-full", STATUS_DOT[s])} />
            {t(`issues.group.${s}` as const)}
            <span className="ml-1 text-xs text-muted-foreground">{countOf(s)}</span>
          </Button>
        ))}
      </div>

      {loadError && <ErrorBanner message={errorMessage(loadError, t("common:common.error.loadFailed"))} />}

      {isInitialLoading
        ? <p className="py-10 text-center text-sm text-muted-foreground">{t("issues.loading")}</p>
        : loadError
          ? null
          : !hasAnyIssue
              ? <p className="py-10 text-center text-sm text-muted-foreground">{t("issues.empty")}</p>
              : (
                  <div className="space-y-3">
                    {visibleStatuses.map((status) => {
                      const groupIssues = queryByStatus[status].data?.data ?? [];
                      const count = countOf(status);
                      // Group headers use the product taxonomy labels (Todo /
                      // In Progress / Completed / Cancelled); the shared
                      // `issues.status.*` copy stays untouched for other surfaces.
                      const label = t(`issues.group.${status}` as const);
                      return (
                        <section key={status} aria-label={label} className="space-y-1.5">
                          {/* Full-width status bar — clicking it selects this status. */}
                          <button
                            type="button"
                            aria-pressed={statusFilter === status}
                            onClick={() => setStatusFilter(status)}
                            className="flex w-full items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Badge variant="secondary" className={cn("text-xs", ISSUE_STATUS_BADGE[status])}>
                              {label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{count}</span>
                          </button>
                          {groupIssues.length === 0
                            ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("issues.emptyColumn")}</p>
                            : (
                                <ul className="space-y-0.5">
                                  {groupIssues.map(issue => (
                                    <li
                                      key={issue.id}
                                      className={cn(
                                        "flex items-center gap-1 rounded-lg transition-colors hover:bg-muted/50",
                                        activeIssueId === issue.id && "bg-muted/60",
                                      )}
                                    >
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        onClick={() => openIssue(issue.id)}
                                      >
                                        {/* Row reads left-to-right: title -> priority -> assignee -> due date. */}
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{issue.title}</span>
                                        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                          <Badge variant={PRIORITY_VARIANTS[issue.priority]} className="text-[10px]">
                                            {t(`issues.priority.${issue.priority}` as const)}
                                          </Badge>
                                          <span className="inline-flex min-w-0 max-w-32 items-center gap-1">
                                            <User aria-hidden="true" className="size-3 shrink-0" />
                                            <span className="truncate">{assigneeLabel(issue)}</span>
                                          </span>
                                          {issue.dueDate && (
                                            <span className="inline-flex shrink-0 items-center gap-1">
                                              <CalendarDays aria-hidden="true" className="size-3 shrink-0" />
                                              {issue.dueDate}
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                      {canPin(issue) && (
                                        <div className="shrink-0 pr-1">
                                          <IssuePinToggle projectId={projectId} issue={issue} />
                                        </div>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                        </section>
                      );
                    })}
                  </div>
                )}

      <CreateIssueDialog
        projectId={projectId}
        members={members}
        memberLabels={memberLabels}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
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
      size="icon"
      className="size-8"
      aria-pressed={issue.pinned}
      aria-label={t(issue.pinned ? "overview.unpinAction" : "overview.pinAction")}
      disabled={togglePin.isPending}
      onClick={(event) => {
        event.stopPropagation();
        const willPin = !issue.pinned;
        togglePin.mutate({ projectId, id: issue.id, pin: willPin }, {
          onSuccess: () => toast.success(t(willPin ? "toast.issuePinned" : "toast.issueUnpinned")),
          onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
        });
      }}
    >
      {issue.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
    </Button>
  );
}

interface CreateIssueDialogProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CreateIssueDialog({ projectId, members, memberLabels, open, onOpenChange }: CreateIssueDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createIssue = useCreateProjectIssue();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>("open");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [dueDate, setDueDate] = useState("");

  const reset = () => {
    setTitle("");
    setDescription("");
    setStatus("open");
    setPriority("medium");
    setAssigneeMemberId("__none__");
    setDueDate("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || createIssue.isPending)
      return;
    const body: CreateProjectIssueInput = {
      title: title.trim(),
      status,
      priority,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(assigneeMemberId !== "__none__" ? { assigneeMemberId } : {}),
      ...(dueDate ? { dueDate } : {}),
    };
    createIssue.mutate({ projectId, ...body }, {
      onSuccess: () => {
        toast.success(t("toast.issueCreated"));
        reset();
        onOpenChange(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  // Rounded pill shared by the inline metadata controls. Border style is added
  // per-control to reflect a set (solid) vs empty (dashed) state.
  const pillBase = "h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal";
  const assigned = assigneeMemberId !== "__none__";
  const assigneeLabel = assigned
    ? memberLabels.get(assigneeMemberId) ?? assigneeMemberId
    : t("issues.field.assignee");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          {/* The borderless title replaces the visible header; keep a
              visually-hidden DialogTitle so the dialog primitive and screen
              readers still announce a name. */}
          <DialogTitle className="sr-only">{t("issues.createTitle")}</DialogTitle>

          {createIssue.error && <ErrorBanner message={errorMessage(createIssue.error, t("common:common.error.operationFailed"))} />}

          <Input
            autoFocus
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t("issues.field.title")}
            aria-label={t("issues.field.title")}
            className="h-auto border-0 bg-transparent px-0 py-0 text-lg font-medium shadow-none focus-visible:border-0 focus-visible:ring-0"
          />

          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("issues.field.descriptionPlaceholder")}
            aria-label={t("issues.field.description")}
            rows={6}
            className="min-h-40 resize-y border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className={cn(pillBase, "border-solid")} />}>
                <span aria-hidden="true" className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                {t(`issues.group.${status}` as const)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={status} onValueChange={v => setStatus(v as IssueStatus)}>
                  {ISSUE_STATUSES.map(s => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      <span aria-hidden="true" className={cn("size-2 rounded-full", STATUS_DOT[s])} />
                      {t(`issues.group.${s}` as const)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className={cn(pillBase, "border-solid")} />}>
                <SignalHigh aria-hidden="true" className={cn("size-4", PRIORITY_TINT[priority])} />
                {t(`issues.priority.${priority}` as const)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={priority} onValueChange={v => setPriority(v as IssuePriority)}>
                  {PRIORITIES.map(p => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      <SignalHigh aria-hidden="true" className={cn("size-4", PRIORITY_TINT[p])} />
                      {t(`issues.priority.${p}` as const)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={(
                <Button
                  type="button"
                  variant="outline"
                  className={cn(pillBase, assigned ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
                />
              )}
              >
                <User aria-hidden="true" className={assigned ? "text-info" : undefined} />
                {assigneeLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={assigneeMemberId} onValueChange={v => setAssigneeMemberId(v as string)}>
                  <DropdownMenuRadioItem value="__none__">{t("issues.unassigned")}</DropdownMenuRadioItem>
                  {members.map(m => (
                    <DropdownMenuRadioItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* The native date input overlays a labeled pill so the browser
                calendar opens directly on click — no intermediate dropdown. */}
            <div className="relative inline-flex">
              <span
                aria-hidden="true"
                className={cn(pillBase, "pointer-events-none inline-flex items-center border", dueDate ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
              >
                <CalendarDays className="size-4" />
                {dueDate || t("issues.field.dueDate")}
              </span>
              <input
                type="date"
                value={dueDate}
                aria-label={t("issues.field.dueDate")}
                onChange={e => setDueDate(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </div>
          </div>

          {/* Sticky footer keeps the actions reachable when a long description
              scrolls the dialog body. */}
          <div className="sticky bottom-0 -mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-popover px-4 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={createIssue.isPending || !title.trim()}>
              {t("issues.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
