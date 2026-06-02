// Issues (work orders) tab: a Linear-style status-grouped list. Search and
// create are the primary top actions. Each status renders as a collapsible
// full-width section bar (chevron + status icon + label + count) that toggles
// its rows open/closed; there is no separate status-filter chip row. Rows are
// compact single-line buttons showing a status icon, the short id, the title,
// a priority signal, a relative due date (overdue accented), and a colored
// assignee avatar. Only fields the issue model actually exposes are shown — no
// fabricated tags or sub-issue progress. A pin toggle is kept as an isolated
// row affordance for the project pinned-home surface. The detail view (drawer /
// fullscreen) opens on row click.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectIssueRow,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ChevronRight,
  Maximize2,
  Minimize2,
  Paperclip,
  Pin,
  PinOff,
  User,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { PriorityGlyph, PrioritySignal } from "@/shared/components/priority-signal";
import { validateAttachmentSelection } from "@/shared/components/resource";
import { formatFileSize } from "@/shared/components/resource/attachment-section";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useUploadLimits } from "@/shared/hooks/use-upload-limits";
import { useToggleIssuePin } from "@/shared/lib/api/pins";
import { useCreateProjectIssue, useIssueTags, useProjectIssues } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { http } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

const PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];
const ISSUE_STATUSES: readonly IssueStatus[] = ["todo", "working", "review", "done", "cancel"];

// Status icon tints, aligned with the global status color tokens.
const STATUS_ICON_TINT: Record<IssueStatus, string> = {
  todo: "text-warning",
  working: "text-info",
  review: "text-primary",
  done: "text-success",
  cancel: "text-muted-foreground/60",
};

// One shared grid template for every row in a status group so cells line up
// vertically across rows. Tracks (left to right):
//   [status+id] [title 1fr] [tags (sm+)] [due (md+)] [assignee] [priority]
// Hidden cells use display:none and drop out of grid flow, so the count of
// visible cells matches the track count at each breakpoint. The title (1fr)
// absorbs all slack, keeping the trailing meta columns right-aligned across
// rows regardless of id/tag width.
const ROW_GRID_CLASS
  = "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] md:grid-cols-[auto_minmax(0,1fr)_auto_5rem_auto_auto]";

// Distinct avatar background palette (deterministic per member id). Uses the
// -700 shade across all hues so white initials clear the 4.5:1 AA contrast
// ratio even at the 10px avatar size (the -500 shades failed for amber/sky/teal).
const AVATAR_COLORS = [
  "bg-rose-700",
  "bg-orange-700",
  "bg-amber-700",
  "bg-emerald-700",
  "bg-teal-700",
  "bg-sky-700",
  "bg-indigo-700",
  "bg-violet-700",
  "bg-fuchsia-700",
  "bg-pink-700",
] as const;

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
// empty circle (todo), half-filled (working), center dot (review), check (done),
// slash (cancel).
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
              {status === "working" && (
                <path d="M8 8 V2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
              )}
              {status === "review" && (
                <circle cx="8" cy="8" r="2.5" fill="currentColor" />
              )}
              {status === "cancel" && (
                <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </>
          )}
    </svg>
  );
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
  const [createStatus, setCreateStatus] = useState<IssueStatus>("todo");
  const [search, setSearch] = useState("");
  // Selected tag ids; empty means no tag filter. An issue matches the union of
  // the selected tags.
  const [selectedTagIds, setSelectedTagIds] = useState<readonly string[]>([]);
  // Per-status collapse of the section's rows (header stays visible).
  const [collapsed, setCollapsed] = useState<Partial<Record<IssueStatus, boolean>>>({});
  const debouncedSearch = useDebounce(search, 300);

  const issueTagsQuery = useIssueTags();
  const issueTags = issueTagsQuery.data ?? [];

  // The drawer is a nested route; read the active issueId (if any) so the open
  // row stays highlighted while its drawer overlays the list.
  const activeParams = useParams({ strict: false }) as { readonly issueId?: string };
  const activeIssueId = activeParams.issueId;

  const q = debouncedSearch || undefined;
  const tagIds = selectedTagIds.length > 0 ? selectedTagIds : undefined;
  // One list request (no status filter); group by status on the client. The
  // rows already carry `status`, so this collapses the former 5-per-status
  // fan-out into a single request and makes counts a client-side reduce. A high
  // limit keeps every status' rows present for grouping.
  const issuesQuery = useProjectIssues(projectId, { q, tagIds, limit: 100 });

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);

  const issuesByStatus = useMemo(() => {
    const map: Record<IssueStatus, ProjectIssueRow[]> = {
      todo: [],
      working: [],
      review: [],
      done: [],
      cancel: [],
    };
    for (const issue of issuesQuery.data?.data ?? [])
      map[issue.status].push(issue);
    return map;
  }, [issuesQuery.data]);

  const countOf = (status: IssueStatus) => issuesByStatus[status].length;
  const totalAll = issuesQuery.data?.data.length ?? 0;

  const loadError = issuesQuery.error;
  const isInitialLoading = issuesQuery.isLoading;
  const hasAnyIssue = totalAll > 0;

  // No status filter: always show every populated status group.
  const visibleStatuses: readonly IssueStatus[] = ISSUE_STATUSES.filter(s => countOf(s) > 0);

  const assigneeLabel = (issue: ProjectIssueRow) =>
    issue.assigneeMemberId
      ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
      : t("issues.unassigned");

  const openIssue = useCallback((issueId: string) => {
    void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId } });
  }, [navigate, projectId]);

  const openCreate = (status: IssueStatus) => {
    setCreateStatus(status);
    setCreateOpen(true);
  };

  const toggleCollapse = useCallback((status: IssueStatus) =>
    setCollapsed(prev => ({ ...prev, [status]: !prev[status] })), []);

  return (
    <div className="space-y-5">
      {/* Top toolbar — tag filter on the left, search + create grouped on the
          right, on a single row that wraps gracefully on narrow widths. The tag
          filter pins the most-used tags as resident toggle chips and folds the
          rest behind the shared Filter dropdown; union semantics narrow the list
          to issues carrying any selected tag. Omitted when the project has no
          tags, keeping search + create right-aligned. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {issueTags.length > 0
          ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <ListFilter
                  dimensions={[
                    {
                      key: "tags",
                      label: t("issues.tagFilter"),
                      mode: "multi",
                      residentCount: 5,
                      value: selectedTagIds,
                      onChange: value => setSelectedTagIds(value),
                      options: issueTags.map(tag => ({ value: tag.id, label: tag.name })),
                    },
                  ]}
                />
              </div>
            )
          : <div />}
        <SearchCreateBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("issues.searchPlaceholder"),
          }}
          {...(canManage ? { create: { label: t("issues.createButton"), onClick: () => openCreate("todo") } } : {})}
        />
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
                      const groupIssues = issuesByStatus[status];
                      const count = countOf(status);
                      const label = t(`issues.status.${status}` as const);
                      const isCollapsed = collapsed[status] ?? false;
                      return (
                        <section key={status} aria-label={label}>
                          {/* Full-width section bar: collapse chevron + status label. */}
                          <div className="flex w-full items-center gap-1 rounded-lg bg-muted/50 px-1.5 py-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-expanded={!isCollapsed}
                              aria-label={t("issues.toggleSection")}
                              className="text-muted-foreground"
                              onClick={() => toggleCollapse(status)}
                            >
                              <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", !isCollapsed && "rotate-90")} />
                            </Button>
                            <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
                              <StatusIcon status={status} label={label} />
                              <span className="text-sm font-medium">{label}</span>
                              <span className="text-xs text-muted-foreground">{count}</span>
                            </div>
                          </div>

                          {!isCollapsed && (
                            groupIssues.length === 0
                              ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("issues.emptyColumn")}</p>
                              : (
                                  <ul className="mt-0.5">
                                    {groupIssues.map((issue) => {
                                      const priorityLabel = t(`issues.priority.${issue.priority}` as const);
                                      // Defensive: a contract-violating / stale-cache row may lack `tags`.
                                      const issueTags = issue.tags ?? [];
                                      return (
                                        <li
                                          key={issue.id}
                                          className={cn(
                                            "group flex items-center rounded-md border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/50",
                                            activeIssueId === issue.id && "bg-muted/60",
                                          )}
                                        >
                                          <button
                                            type="button"
                                            className={cn(
                                              ROW_GRID_CLASS,
                                              "min-w-0 flex-1 items-center gap-x-3 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            )}
                                            onClick={() => openIssue(issue.id)}
                                          >
                                            {/* status + id share the leading column */}
                                            <span className="flex items-center gap-2.5">
                                              <StatusIcon status={issue.status} label={label} />
                                              <span className="font-mono text-xs text-muted-foreground tabular-nums">{issue.id}</span>
                                            </span>
                                            <span className="min-w-0 truncate text-sm">{issue.title}</span>
                                            {/* tags column — always rendered (empty when none) so every row keeps the shared template */}
                                            <div className="hidden items-center gap-1 sm:flex">
                                              {issueTags.slice(0, 3).map(tag => (
                                                <Badge key={tag.id} variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                                                  {tag.name}
                                                </Badge>
                                              ))}
                                            </div>
                                            {/* due column — md+ only, always rendered to preserve its grid track */}
                                            <div className="hidden justify-end text-xs md:flex">
                                              {issue.dueDate && <DueLabel value={issue.dueDate} />}
                                            </div>
                                            <MemberAvatar id={issue.assigneeMemberId} label={assigneeLabel(issue)} />
                                            <PrioritySignal priority={issue.priority} label={priorityLabel} />
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

      {canManage && (
        <CreateIssueDialog
          key={createStatus}
          projectId={projectId}
          members={members}
          memberLabels={memberLabels}
          initialStatus={createStatus}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
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
  const { t } = useTranslation(["projects", "common", "issues"]);
  const createIssue = useCreateProjectIssue();
  const limits = useUploadLimits();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>(initialStatus);
  const [priority, setPriority] = useState<IssuePriority>("low");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [dueDate, setDueDate] = useState("");
  // The issue does not exist until creation, so selected attachments are staged
  // here and uploaded to the new issue once the create resolves.
  const [files, setFiles] = useState<File[]>([]);
  // When on, a successful create resets the form and keeps the dialog open so
  // the user can file several issues in a row.
  const [keepOpen, setKeepOpen] = useState(false);
  // Toggles the dialog between its default width and a roomy maximized size.
  const [maximized, setMaximized] = useState(false);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Stage a file selection: validate against the same limits the issue panel
  // enforces (count + per-file size), then keep accepted files in state.
  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0)
      return;
    const validation = validateAttachmentSelection(picked, files.length, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (validation === "limit") {
      toast.error(t("issues:attachments.limitReached"));
      return;
    }
    if (validation === "size") {
      toast.error(t("issues:attachments.fileTooLarge"));
      return;
    }
    setFiles(prev => [...prev, ...picked]);
  };

  // Drop a single staged file before submit; in-memory only (the issue does
  // not exist yet, so there is nothing to delete server-side).
  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

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
    setPriority("low");
    setAssigneeMemberId("__none__");
    setDueDate("");
    setFiles([]);
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
    const staged = files;
    createIssue.mutate({ projectId, ...body }, {
      onSuccess: async (created) => {
        // The issue exists now, so upload any staged attachments to it. An
        // upload failure is surfaced but does not undo the created issue.
        if (staged.length > 0) {
          try {
            for (const file of staged) {
              const fd = new FormData();
              fd.append("file", file);
              await http(`/projects/${projectId}/issues/${created.id}/attachments`, { method: "POST", body: fd });
            }
          }
          catch (err) {
            toast.error(errorMessage(err, t("common:common.error.operationFailed")));
          }
        }
        toast.success(t("toast.issueCreated"));
        reset();
        if (!keepOpen)
          onOpenChange(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  // Rounded pill shared by the inline metadata controls. Border style is added
  // per-control to reflect a set (solid) vs empty (dashed) state.
  const pillBase = "gap-1.5 rounded-full px-2.5 text-xs font-normal";
  const assigned = assigneeMemberId !== "__none__";
  const assigneeLabel = assigned
    ? memberLabels.get(assigneeMemberId) ?? assigneeMemberId
    : t("issues.field.assignee");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto pb-0",
          maximized ? "min-h-[80svh] sm:max-w-3xl" : "sm:max-w-xl",
        )}
      >
        {/* Window controls float at the top-right corner; the breadcrumb header
            is gone, so the body starts straight at the title. The primitive's
            own close is disabled in favor of this DialogClose. */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(maximized ? "issues.composer.minimize" : "issues.composer.maximize")}
            onClick={() => setMaximized(m => !m)}
          >
            {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </Button>
          <DialogClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:common.close")} />}>
            <X aria-hidden="true" />
          </DialogClose>
        </div>

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
            placeholder={t("issues.composer.titlePlaceholder")}
            aria-label={t("issues.field.title")}
            className="h-auto border-0 bg-transparent px-0 py-0 pr-16 text-lg font-medium shadow-none focus-visible:border-0 focus-visible:ring-0"
          />

          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("issues.field.descriptionPlaceholder")}
            aria-label={t("issues.field.description")}
            rows={6}
            className={cn(
              "resize-y border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0",
              maximized ? "min-h-[60svh]" : "min-h-40",
            )}
          />

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className={cn(pillBase, "border-solid")} />}>
                <StatusIcon status={status} label={t(`issues.status.${status}` as const)} />
                {t(`issues.status.${status}` as const)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={status} onValueChange={v => setStatus(v as IssueStatus)}>
                  {ISSUE_STATUSES.map(s => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      <StatusIcon status={s} label={t(`issues.status.${s}` as const)} />
                      {t(`issues.status.${s}` as const)}
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

            {/* Attachment pill: stages files now, uploads them after the issue
                is created. The single attach affordance for the dialog. */}
            <Button
              type="button"
              variant="outline"
              className={cn(pillBase, "border", files.length > 0 ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
              onClick={() => attachInputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" className={files.length > 0 ? "text-info" : undefined} />
              {t("issues.composer.attach")}
              {files.length > 0 && <span className="tabular-nums">{`· ${files.length}`}</span>}
            </Button>
            <input
              ref={attachInputRef}
              type="file"
              multiple
              tabIndex={-1}
              aria-label={t("issues.composer.attach")}
              onChange={onPickFiles}
              className="sr-only"
            />
          </div>

          {/* Staged attachments: visible before submit so files can be removed.
              Cleared by reset() after a successful create. */}
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex h-9 items-center gap-2 rounded-md border bg-card px-2.5"
                >
                  <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{file.name}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{formatFileSize(file.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("issues.composer.removeAttachment")}
                    onClick={() => removeFile(index)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Sticky footer keeps the actions reachable when a long description
              scrolls the dialog body. Holds only the continue toggle + submit. */}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 rounded-b-xl border-t bg-popover px-4 py-2.5">
            {/* Functional: keep the dialog open and reset after each create. */}
            <div className="flex items-center gap-1.5">
              <Switch id="issue-keep-open" size="sm" checked={keepOpen} onCheckedChange={setKeepOpen} />
              <Label htmlFor="issue-keep-open" className="text-xs font-normal text-muted-foreground">
                {t("issues.composer.continueCreate")}
              </Label>
            </div>
            <Button type="submit" disabled={createIssue.isPending || !title.trim()}>
              {t("issues.composer.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
