// Issues (work orders) tab: a Linear-style status-grouped list. Search and
// create are the primary top actions; a clickable status-filter chip row and
// clickable section headers both select the active status. Each status renders
// as a collapsible full-width section bar (chevron + label + count + a "+"
// quick-create that pre-sets that status); rows are compact single-line buttons
// showing a status icon, the short id, the title, a priority signal, a relative
// due date (overdue accented), and a colored assignee avatar. Only fields the
// issue model actually exposes are shown — no fabricated tags or sub-issue
// progress. A pin toggle is kept as an isolated row affordance for the project
// pinned-home surface. The detail view (drawer / fullscreen) opens on row click.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectIssueRow,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronRight,
  Pin,
  PinOff,
  Plus,
  Search,
  SignalHigh,
  SignalLow,
  SignalMedium,
  User,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

// Priority signal icons (ascending bars), tinted by severity — shared by the
// row indicator and the create dialog selector.
const PRIORITY_META: Record<IssuePriority, { readonly Icon: typeof SignalLow; readonly tone: string }> = {
  low: { Icon: SignalLow, tone: "text-muted-foreground" },
  medium: { Icon: SignalMedium, tone: "text-muted-foreground" },
  high: { Icon: SignalHigh, tone: "text-warning" },
  urgent: { Icon: AlertTriangle, tone: "text-destructive" },
};

const PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];
const ISSUE_STATUSES: readonly IssueStatus[] = ["open", "in_progress", "done", "cancelled"];

// Status icon tints, aligned with the global status color tokens.
const STATUS_ICON_TINT: Record<IssueStatus, string> = {
  open: "text-muted-foreground",
  in_progress: "text-info",
  done: "text-success",
  cancelled: "text-muted-foreground/60",
};

// Small status dot used by the filter chips + create dialog selector.
const STATUS_DOT: Record<IssueStatus, string> = {
  open: "bg-warning",
  in_progress: "bg-info",
  done: "bg-success",
  cancelled: "bg-muted-foreground",
};

// Distinct avatar background palette (deterministic per member id).
const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
] as const;

type StatusFilter = IssueStatus | "all";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0)
    return "?";
  if (parts.length === 1)
    return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1)
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

// Status glyphs drawn inline so they read identically across lucide versions:
// empty circle (todo), half-filled (in progress), check (done), slash (cancelled).
function StatusIcon({ status, label }: { readonly status: IssueStatus; readonly label: string }) {
  const tint = STATUS_ICON_TINT[status];
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", tint)} role="img" aria-label={label}>
      {status === "done"
        ? (
            <>
              <circle cx="8" cy="8" r="7" fill="currentColor" />
              <path d="M4.7 8.2l2.2 2.2 4.4-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )
        : (
            <>
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              {status === "in_progress" && (
                <path d="M8 8 V2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
              )}
              {status === "cancelled" && (
                <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </>
          )}
    </svg>
  );
}

function PrioritySignal({ priority, label }: { readonly priority: IssuePriority; readonly label: string }) {
  const { Icon, tone } = PRIORITY_META[priority];
  return (
    <span className="inline-flex shrink-0" title={label} aria-label={label}>
      <Icon aria-hidden="true" className={cn("size-3.5", tone)} />
    </span>
  );
}

/** Bare priority icon for the create dialog's pill/selector (no title wrapper). */
function PriorityGlyph({ priority }: { readonly priority: IssuePriority }) {
  const { Icon, tone } = PRIORITY_META[priority];
  return <Icon aria-hidden="true" className={cn("size-4", tone)} />;
}

function MemberAvatar({ id, label }: { readonly id: string | null; readonly label: string }) {
  if (!id) {
    return (
      <span
        title={label}
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40"
      >
        <User aria-hidden="true" className="size-3 text-muted-foreground/50" />
      </span>
    );
  }
  return (
    <span
      title={label}
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white", avatarColor(id))}
    >
      {initialsOf(label)}
    </span>
  );
}

// Start-of-day timestamp for "now", captured once per mount (kept out of render
// to stay pure; the relative label does not need to tick within a session).
function useStartOfToday(): number {
  const [todayTs] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  return todayTs;
}

// Relative due date with an overdue/today accent. `value` is a YYYY-MM-DD date.
function DueLabel({ value }: { readonly value: string }) {
  const { t } = useTranslation("projects");
  const todayTs = useStartOfToday();
  const parts = value.split("-").map(Number);
  const due = new Date(parts[0]!, (parts[1]! - 1), parts[2]!);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - todayTs) / 86_400_000);

  let text: string;
  let tone = "text-muted-foreground";
  if (diff < 0) {
    text = t("issues.due.overdue", { count: -diff });
    tone = "text-destructive";
  }
  else if (diff === 0) {
    text = t("issues.due.today");
    tone = "text-warning";
  }
  else if (diff === 1) {
    text = t("issues.due.tomorrow");
  }
  else {
    text = t("issues.due.inDays", { count: diff });
  }

  return (
    <span title={value} className={cn("shrink-0 whitespace-nowrap tabular-nums", tone)}>
      {text}
    </span>
  );
}

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
  const [createStatus, setCreateStatus] = useState<IssueStatus>("open");
  const [search, setSearch] = useState("");
  // Selected status; "all" shows every populated section.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Per-status collapse of the section's rows (header stays visible).
  const [collapsed, setCollapsed] = useState<Partial<Record<IssueStatus, boolean>>>({});
  const debouncedSearch = useDebounce(search, 300);

  // The drawer is a nested route; read the active issueId (if any) so the open
  // row stays highlighted while its drawer overlays the list.
  const activeParams = useParams({ strict: false }) as { readonly issueId?: string };
  const activeIssueId = activeParams.issueId;

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

  const openCreate = (status: IssueStatus) => {
    setCreateStatus(status);
    setCreateOpen(true);
  };

  const toggleCollapse = (status: IssueStatus) =>
    setCollapsed(prev => ({ ...prev, [status]: !prev[status] }));

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
        <Button onClick={() => openCreate("open")}>
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
                  <div className="space-y-2.5">
                    {visibleStatuses.map((status) => {
                      const groupIssues = queryByStatus[status].data?.data ?? [];
                      const count = countOf(status);
                      const label = t(`issues.group.${status}` as const);
                      const isCollapsed = collapsed[status] ?? false;
                      return (
                        <section key={status} aria-label={label}>
                          {/* Full-width section bar: collapse chevron + status filter + quick-create. */}
                          <div
                            className={cn(
                              "flex w-full items-center gap-1 rounded-lg bg-muted/50 px-1.5 py-1 transition-colors",
                              statusFilter === status && "ring-1 ring-inset ring-primary/30",
                            )}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-expanded={!isCollapsed}
                              aria-label={t("issues.toggleSection")}
                              className="size-6 text-muted-foreground"
                              onClick={() => toggleCollapse(status)}
                            >
                              <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", !isCollapsed && "rotate-90")} />
                            </Button>
                            <button
                              type="button"
                              aria-pressed={statusFilter === status}
                              aria-label={label}
                              onClick={() => setStatusFilter(status)}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <StatusIcon status={status} label={label} />
                              <span className="text-sm font-medium">{label}</span>
                              <span className="text-xs text-muted-foreground">{count}</span>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("issues.createInStatus", { status: label })}
                              className="size-6 text-muted-foreground"
                              onClick={() => openCreate(status)}
                            >
                              <Plus aria-hidden="true" className="size-4" />
                            </Button>
                          </div>

                          {!isCollapsed && (
                            groupIssues.length === 0
                              ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("issues.emptyColumn")}</p>
                              : (
                                  <ul className="mt-0.5">
                                    {groupIssues.map((issue) => {
                                      const priorityLabel = t(`issues.priority.${issue.priority}` as const);
                                      return (
                                        <li
                                          key={issue.id}
                                          className={cn(
                                            "group flex items-center rounded-md transition-colors hover:bg-muted/50",
                                            activeIssueId === issue.id && "bg-muted/60",
                                          )}
                                        >
                                          <button
                                            type="button"
                                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            onClick={() => openIssue(issue.id)}
                                          >
                                            <StatusIcon status={issue.status} label={label} />
                                            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{issue.id}</span>
                                            <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                                            <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
                                              <PrioritySignal priority={issue.priority} label={priorityLabel} />
                                              {issue.dueDate && <DueLabel value={issue.dueDate} />}
                                              <MemberAvatar id={issue.assigneeMemberId} label={assigneeLabel(issue)} />
                                            </div>
                                          </button>
                                          {canPin(issue) && (
                                            <div
                                              className={cn(
                                                "shrink-0 pr-1 transition-opacity",
                                                issue.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                                              )}
                                            >
                                              <IssuePinToggle projectId={projectId} issue={issue} />
                                            </div>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}

      <CreateIssueDialog
        key={createStatus}
        projectId={projectId}
        members={members}
        memberLabels={memberLabels}
        initialStatus={createStatus}
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
      size="icon-sm"
      className="size-7"
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
  readonly initialStatus: IssueStatus;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CreateIssueDialog({ projectId, members, memberLabels, initialStatus, open, onOpenChange }: CreateIssueDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createIssue = useCreateProjectIssue();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>(initialStatus);
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [dueDate, setDueDate] = useState("");
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  // Open the native calendar on click; fall back to focus when showPicker is
  // unavailable (older browsers / programmatic-open restrictions).
  const openDuePicker = () => {
    const input = dueDateInputRef.current;
    if (!input)
      return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      }
      catch {
        // showPicker can throw if not allowed; fall through to focus.
      }
    }
    input.focus();
  };

  const reset = () => {
    setTitle("");
    setDescription("");
    setStatus(initialStatus);
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

          <div className="flex flex-wrap items-center gap-2 pb-2">
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
                <PriorityGlyph priority={priority} />
                {t(`issues.priority.${priority}` as const)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={priority} onValueChange={v => setPriority(v as IssuePriority)}>
                  {PRIORITIES.map(p => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      <PriorityGlyph priority={p} />
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

            {/* A focusable pill button opens the native calendar via showPicker;
                the date input itself stays visually hidden but keeps the value. */}
            <div className="inline-flex items-center">
              <Button
                type="button"
                variant="outline"
                className={cn(pillBase, "border", dueDate ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
                onClick={openDuePicker}
              >
                {dueDate || t("issues.field.dueDate")}
              </Button>
              <input
                ref={dueDateInputRef}
                type="date"
                value={dueDate}
                aria-label={t("issues.field.dueDate")}
                tabIndex={-1}
                onChange={e => setDueDate(e.target.value)}
                className="sr-only"
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
