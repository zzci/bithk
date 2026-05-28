// Issues (work orders) tab: compact status-grouped list + create dialog. Each
// status (open / in_progress / done / cancelled) is its own queried group with
// a visible count. Any project member can create a work order; the assignee
// picker lists project members.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectIssueRow,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, Pin, PinOff, Plus, SignalHigh, User, X } from "lucide-react";
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Separator } from "@/shared/components/ui/separator";
import { Textarea } from "@/shared/components/ui/textarea";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useToggleIssuePin } from "@/shared/lib/api/pins";
import { useCreateProjectIssue, useProjectIssues } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

const PRIORITY_VARIANTS: Record<IssuePriority, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};

const PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];

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

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  // Query each status group independently with the active search term so every
  // status stays visible without a top-level status filter, and each group can
  // surface its own total from `meta.total`.
  const q = debouncedSearch || undefined;
  const openQuery = useProjectIssues(projectId, { status: "open", q });
  const inProgressQuery = useProjectIssues(projectId, { status: "in_progress", q });
  const doneQuery = useProjectIssues(projectId, { status: "done", q });
  const cancelledQuery = useProjectIssues(projectId, { status: "cancelled", q });

  const groups: ReadonlyArray<{ status: IssueStatus; query: ReturnType<typeof useProjectIssues> }> = [
    { status: "open", query: openQuery },
    { status: "in_progress", query: inProgressQuery },
    { status: "done", query: doneQuery },
    { status: "cancelled", query: cancelledQuery },
  ];

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const loadError = groups.find(g => g.query.error)?.query.error;
  const isInitialLoading = groups.every(g => g.query.isLoading);
  const hasAnyIssue = groups.some(g => (g.query.data?.data.length ?? 0) > 0);

  const assigneeLabel = (issue: ProjectIssueRow) =>
    issue.assigneeMemberId
      ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
      : t("issues.unassigned");

  const openIssue = (issueId: string) => {
    void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId } });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder={t("issues.searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-xs sm:flex-1"
          aria-label={t("issues.searchPlaceholder")}
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" />
          {t("issues.create")}
        </Button>
      </div>

      {loadError && <ErrorBanner message={errorMessage(loadError, t("common:common.error.loadFailed"))} />}

      {isInitialLoading
        ? <p className="py-10 text-center text-sm text-muted-foreground">{t("issues.loading")}</p>
        : loadError
          ? null
          : !hasAnyIssue
              ? <p className="py-10 text-center text-sm text-muted-foreground">{t("issues.empty")}</p>
              : (
                  <div className="space-y-5">
                    {groups.map(({ status, query }) => {
                      const groupIssues = query.data?.data ?? [];
                      const count = query.data?.meta.total ?? groupIssues.length;
                      const label = t(`issues.status.${status}` as const);
                      return (
                        <section key={status} aria-label={label}>
                          <div className="mb-1.5 flex items-center gap-2 px-0.5">
                            <Badge variant="secondary" className={`text-xs ${ISSUE_STATUS_BADGE[status]}`}>
                              {label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{count}</span>
                          </div>
                          {groupIssues.length === 0
                            ? (
                                <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                                  {t("issues.emptyColumn")}
                                </p>
                              )
                            : (
                                <ul className="divide-y rounded-md border">
                                  {groupIssues.map(issue => (
                                    <li key={issue.id} className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        onClick={() => openIssue(issue.id)}
                                      >
                                        <span className="w-full break-words text-sm font-medium">{issue.title}</span>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                          <Badge variant={PRIORITY_VARIANTS[issue.priority]} className="text-[10px]">
                                            {t(`issues.priority.${issue.priority}` as const)}
                                          </Badge>
                                          <span className="inline-flex min-w-0 items-center gap-1">
                                            <User aria-hidden="true" className="size-3 shrink-0" />
                                            <span className="break-all">{assigneeLabel(issue)}</span>
                                          </span>
                                          {issue.dueDate && (
                                            <span className="inline-flex items-center gap-1">
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
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [dueDate, setDueDate] = useState("");

  const reset = () => {
    setTitle("");
    setDescription("");
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

  // Dashed-border rounded pill shared by the inline metadata controls.
  const pillClassName = "h-7 gap-1.5 rounded-full border-dashed px-2.5 text-xs font-normal";
  const assigneeLabel = assigneeMemberId === "__none__"
    ? t("issues.field.assignee")
    : memberLabels.get(assigneeMemberId) ?? assigneeMemberId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
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
            rows={2}
            className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className={pillClassName} />}>
                <SignalHigh aria-hidden="true" />
                {t(`issues.priority.${priority}` as const)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={priority} onValueChange={v => setPriority(v as IssuePriority)}>
                  {PRIORITIES.map(p => (
                    <DropdownMenuRadioItem key={p} value={p}>{t(`issues.priority.${p}` as const)}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className={pillClassName} />}>
                <User aria-hidden="true" />
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

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" className={pillClassName} />}>
                <CalendarDays aria-hidden="true" />
                {dueDate || t("issues.field.dueDate")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="p-2">
                <Input
                  type="date"
                  value={dueDate}
                  aria-label={t("issues.field.dueDate")}
                  onChange={e => setDueDate(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                />
                {dueDate && (
                  <DropdownMenuItem className="mt-1" onClick={() => setDueDate("")}>
                    <X aria-hidden="true" />
                    {t("issues.field.clearDueDate")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Separator />

          <div className="flex justify-end gap-2">
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
