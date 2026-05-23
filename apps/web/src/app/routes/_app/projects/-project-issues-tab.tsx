// Issues (work orders) tab: filterable list + create dialog. Any project
// member can create a work order. Assignee picker lists project members.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
import { buildMemberLabelMap } from "./-member-helpers";

const STATUS_VARIANTS: Record<IssueStatus, "default" | "outline" | "secondary"> = {
  open: "outline",
  in_progress: "default",
  done: "secondary",
  cancelled: "secondary",
};

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
}

export function ProjectIssuesTab({ projectId, members, userNames }: ProjectIssuesTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [priorityFilter, setPriorityFilter] = useState("__all__");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const issuesQuery = useProjectIssues(projectId, {
    q: debouncedSearch || undefined,
    status: statusFilter === "__all__" ? undefined : (statusFilter as IssueStatus),
    priority: priorityFilter === "__all__" ? undefined : (priorityFilter as IssuePriority),
    page,
  });

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const issues = issuesQuery.data?.data ?? [];
  const meta = issuesQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t("issues.searchPlaceholder")}
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
            <SelectTrigger className="w-36">
              <SelectValue>
                {(v: string) => (v === "__all__" ? t("issues.allStatuses") : t(`issues.status.${v}` as const))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("issues.allStatuses")}</SelectItem>
              <SelectItem value="open">{t("issues.status.open")}</SelectItem>
              <SelectItem value="in_progress">{t("issues.status.in_progress")}</SelectItem>
              <SelectItem value="done">{t("issues.status.done")}</SelectItem>
              <SelectItem value="cancelled">{t("issues.status.cancelled")}</SelectItem>
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
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t("issues.create")}
        </Button>
      </div>

      {issuesQuery.error && <ErrorBanner message={errorMessage(issuesQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
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
                      onClick={() => void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId: issue.id } })}
                    >
                      <TableCell className="font-medium">{issue.title}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[issue.status]} className="text-xs">
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
