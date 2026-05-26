// Issues (work orders) tab: filterable list + create dialog. Any project
// member can create a work order. Assignee picker lists project members.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGrid, List, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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
import { Textarea } from "@/shared/components/ui/textarea";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useCreateProjectIssue, useProjectIssues } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";
import { buildMemberLabelMap } from "./-member-helpers";
import { StatCard, StatStrip } from "./-project-stats";

const PRIORITY_VARIANTS: Record<IssuePriority, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};

const PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];
const STATUSES: readonly IssueStatus[] = ["open", "in_progress", "done", "cancelled"];

type IssueViewMode = "list" | "kanban";

interface ProjectIssuesTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
}

export function ProjectIssuesTab({ projectId, members, userNames }: ProjectIssuesTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [priorityFilter, setPriorityFilter] = useState("__all__");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<IssueViewMode>("list");
  const debouncedSearch = useDebounce(search, 300);

  const issuesQuery = useProjectIssues(projectId, {
    q: debouncedSearch || undefined,
    status: statusFilter === "__all__" ? undefined : (statusFilter as IssueStatus),
    priority: priorityFilter === "__all__" ? undefined : (priorityFilter as IssuePriority),
    page,
  });

  // Filter-independent counts that back the summary strip (also serving as the
  // status filter chips). `limit: 1` keeps the payload tiny.
  const totalCountQuery = useProjectIssues(projectId, { limit: 1 });
  const openCountQuery = useProjectIssues(projectId, { status: "open", limit: 1 });
  const inProgressCountQuery = useProjectIssues(projectId, { status: "in_progress", limit: 1 });
  const doneCountQuery = useProjectIssues(projectId, { status: "done", limit: 1 });
  const cancelledCountQuery = useProjectIssues(projectId, { status: "cancelled", limit: 1 });
  const statCount = (n: number | undefined) => (n === undefined ? "—" : n);

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const issues = issuesQuery.data?.data ?? [];
  const meta = issuesQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;
  const statusCounts: Record<IssueStatus, number | undefined> = {
    open: openCountQuery.data?.meta.total,
    in_progress: inProgressCountQuery.data?.meta.total,
    done: doneCountQuery.data?.meta.total,
    cancelled: cancelledCountQuery.data?.meta.total,
  };

  const setStatus = (next: string) => {
    setStatusFilter(next);
    setPage(1);
  };

  const openIssue = (issueId: string) => {
    void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId } });
  };

  return (
    <div className="space-y-4">
      <StatStrip>
        <StatCard
          label={t("issues.stats.total")}
          value={statCount(totalCountQuery.data?.meta.total)}
          active={statusFilter === "__all__"}
          onClick={() => setStatus("__all__")}
        />
        <StatCard
          label={t("issues.stats.pending")}
          value={statCount(openCountQuery.data?.meta.total)}
          active={statusFilter === "open"}
          onClick={() => setStatus(statusFilter === "open" ? "__all__" : "open")}
        />
        <StatCard
          label={t("issues.stats.inProgress")}
          value={statCount(inProgressCountQuery.data?.meta.total)}
          active={statusFilter === "in_progress"}
          onClick={() => setStatus(statusFilter === "in_progress" ? "__all__" : "in_progress")}
        />
        <StatCard
          label={t("issues.stats.done")}
          value={statCount(doneCountQuery.data?.meta.total)}
          active={statusFilter === "done"}
          onClick={() => setStatus(statusFilter === "done" ? "__all__" : "done")}
        />
      </StatStrip>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={statusFilter === "__all__" ? "default" : "outline"}
          className="h-8 rounded-full"
          aria-pressed={statusFilter === "__all__"}
          onClick={() => setStatus("__all__")}
        >
          {t("issues.allStatuses")}
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
            {statCount(totalCountQuery.data?.meta.total)}
          </Badge>
        </Button>
        {STATUSES.map(status => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? "default" : "outline"}
            className="h-8 rounded-full"
            aria-pressed={statusFilter === status}
            onClick={() => setStatus(statusFilter === status ? "__all__" : status)}
          >
            {t(`issues.status.${status}` as const)}
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {statCount(statusCounts[status])}
            </Badge>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t("issues.searchPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-xs"
            aria-label={t("issues.searchPlaceholder")}
          />
          <Select
            value={priorityFilter}
            onValueChange={(v) => {
              if (v === null)
                return;
              setPriorityFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue>
                {(v: string) => (v === "__all__" ? t("issues.allPriorities") : t(`issues.priority.${v}` as const))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("issues.allPriorities")}</SelectItem>
              {PRIORITIES.map(p => (
                <SelectItem key={p} value={p}>{t(`issues.priority.${p}` as const)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-1" aria-label={t("issues.viewMode")}>
            <Button
              type="button"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              aria-pressed={viewMode === "list"}
              aria-label={t("issues.viewList")}
              onClick={() => setViewMode("list")}
            >
              <List aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              aria-pressed={viewMode === "kanban"}
              aria-label={t("issues.viewKanban")}
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid aria-hidden="true" />
            </Button>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t("issues.create")}
          </Button>
        </div>
      </div>

      {issuesQuery.error && <ErrorBanner message={errorMessage(issuesQuery.error, t("common:common.error.loadFailed"))} />}

      {viewMode === "kanban" && !issuesQuery.isLoading
        ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              {STATUSES.map(status => (
                <div key={status} className="min-h-40 rounded-md border bg-muted/20">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">{t(`issues.status.${status}` as const)}</span>
                    <Badge variant="secondary" className="text-xs">{issues.filter(issue => issue.status === status).length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2 p-2">
                    {issues.filter(issue => issue.status === status).length === 0
                      ? <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t("issues.emptyColumn")}</p>
                      : issues.filter(issue => issue.status === status).map(issue => (
                          <button
                            key={issue.id}
                            type="button"
                            className="rounded-md border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => openIssue(issue.id)}
                          >
                            <div className="line-clamp-2 text-sm font-medium">{issue.title}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              <Badge variant={PRIORITY_VARIANTS[issue.priority]} className="text-xs">
                                {t(`issues.priority.${issue.priority}` as const)}
                              </Badge>
                              {issue.assigneeMemberId && (
                                <Badge variant="outline" className="max-w-full truncate text-xs">
                                  {memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId}
                                </Badge>
                              )}
                            </div>
                          </button>
                        ))}
                  </div>
                </div>
              ))}
            </div>
          )
        : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("issues.col.title")}</TableHead>
                    <TableHead>{t("issues.col.status")}</TableHead>
                    <TableHead>{t("issues.col.priority")}</TableHead>
                    <TableHead>{t("issues.col.assignee")}</TableHead>
                    <TableHead>{t("issues.col.dueDate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issuesQuery.isLoading
                    ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{t("issues.loading")}</TableCell></TableRow>
                    : issues.length === 0
                      ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{t("issues.empty")}</TableCell></TableRow>
                      : issues.map(issue => (
                          <TableRow
                            key={issue.id}
                            className="cursor-pointer"
                            onClick={() => openIssue(issue.id)}
                          >
                            <TableCell>
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto justify-start p-0 text-left font-medium text-foreground"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openIssue(issue.id);
                                }}
                              >
                                {issue.title}
                              </Button>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={`text-xs ${ISSUE_STATUS_BADGE[issue.status]}`}>
                                {t(`issues.status.${issue.status}` as const)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={PRIORITY_VARIANTS[issue.priority]} className="text-xs">
                                {t(`issues.priority.${issue.priority}` as const)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {issue.assigneeMemberId
                                ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
                                : <span className="text-muted-foreground">{t("issues.unassigned")}</span>}
                            </TableCell>
                            <TableCell className="text-sm">{issue.dueDate ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                </TableBody>
              </Table>
              {totalPages > 1 && meta && (
                <div className="flex items-center justify-between border-t px-3 py-2">
                  <span className="text-xs text-muted-foreground">{t("issues.total", { count: meta.total })}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
                    <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
                  </div>
                </div>
              )}
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
        reset();
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("issues.createTitle")}</DialogTitle>
            <DialogDescription>{t("issues.createDescription")}</DialogDescription>
          </DialogHeader>

          {createIssue.error && <ErrorBanner message={errorMessage(createIssue.error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="issue-title">{t("issues.field.title")}</Label>
            <Input
              id="issue-title"
              autoFocus
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-description">{t("issues.field.description")}</Label>
            <Textarea
              id="issue-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("issues.field.descriptionPlaceholder")}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("issues.field.priority")}</Label>
              <Select value={priority} onValueChange={v => v !== null && setPriority(v as IssuePriority)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => t(`issues.priority.${v}` as const)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>{t(`issues.priority.${p}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue-due">{t("issues.field.dueDate")}</Label>
              <Input
                id="issue-due"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("issues.field.assignee")}</Label>
            <Select value={assigneeMemberId} onValueChange={v => v !== null && setAssigneeMemberId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => (v === "__none__" ? t("issues.unassigned") : memberLabels.get(v) ?? v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("issues.unassigned")}</SelectItem>
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
            <Button type="submit" disabled={createIssue.isPending || !title.trim()}>
              {t("issues.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
