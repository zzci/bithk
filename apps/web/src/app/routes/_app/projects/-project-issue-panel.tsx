/* eslint-disable react-refresh/only-export-components */
// Project work-order detail panel. Mounted as a drawer from the project Issues
// tab and as a fullscreen page at `/projects/$projectId/issues/$issueId`.
// Assignment is member-based (`project_members.id`); all reads/writes go
// through the project-scoped issue endpoints.

import type { UpdateProjectIssueInput } from "./-project-issue-hooks";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import {
  ArrowLeft,
  Maximize2,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "@/shared/components/editor";
import {
  ResourceFooterSections,
  useResourceAttachmentUpload,
  validateAttachmentSelection,
} from "@/shared/components/resource";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";
import {
  useDeleteProjectIssue,
  useProjectIssue,
  useUpdateProjectIssue,
} from "./-project-issue-hooks";

// ── Helpers ──

export const statusVariants: Record<string, "default" | "outline" | "secondary"> = {
  open: "outline",
  in_progress: "default",
  done: "secondary",
  cancelled: "secondary",
};

export const priorityVariants: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};

export function statusKey(s: string) {
  const map: Record<string, string> = { open: "Open", in_progress: "InProgress", done: "Done", cancelled: "Cancelled" };
  return map[s] ?? s;
}

export function priorityKey(p: string) {
  const map: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
  return map[p] ?? p;
}

const STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// ── ProjectIssuePanel ──

interface ProjectIssuePanelProps {
  readonly projectId: string;
  readonly issueId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  /** True when the caller is a pm or app admin (can edit every field). */
  readonly canManage: boolean;
  readonly variant: "drawer" | "fullscreen";
  readonly onClose: (opts?: { deleted?: boolean }) => void;
  readonly onMaximize?: () => void;
}

export function ProjectIssuePanel({
  projectId,
  issueId,
  members,
  userNames,
  canManage,
  variant,
  onClose,
  onMaximize,
}: ProjectIssuePanelProps) {
  const { t } = useTranslation("issues");
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const issueQuery = useProjectIssue(projectId, issueId);
  const updateIssue = useUpdateProjectIssue();
  const deleteIssue = useDeleteProjectIssue();
  const issue = issueQuery.data ?? null;

  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  // ResourceFooterSections renders comment authors from a `{ id, name }` map.
  const userMap = useMemo(
    () => new Map(Array.from(userNames, ([id, name]) => [id, { id, name }])),
    [userNames],
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Drafts are seeded when entering edit mode (below), so no effect sync.
  const startEditTitle = () => {
    if (!issue)
      return;
    setTitleDraft(issue.title);
    setEditingTitle(true);
  };
  const startEditDesc = () => {
    setDescDraft(issue?.description ?? "");
    setEditingDesc(true);
  };

  const { upload, fileInputRef, limits, attachmentCount } = useResourceAttachmentUpload({
    resource: `projects/${projectId}/issues`,
    resourceId: issueId,
    onError: err => setError(errorMessage(err, t("common.error.uploadFailed"))),
  });

  const handleUpload = (files: FileList | null) => {
    if (!files || files.length === 0 || upload.isPending)
      return;
    setError(null);
    const selected = Array.from(files);
    const validation = validateAttachmentSelection(selected, attachmentCount, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (validation === "limit") {
      setError(t("attachments.limitReached"));
      if (fileInputRef.current)
        fileInputRef.current.value = "";
      return;
    }
    if (validation === "size") {
      setError(t("attachments.fileTooLarge"));
      if (fileInputRef.current)
        fileInputRef.current.value = "";
      return;
    }
    upload.mutate(selected);
  };

  const patch = (body: UpdateProjectIssueInput) => {
    updateIssue.mutate({ projectId, issueId, ...body }, {
      onError: err => setError(errorMessage(err, t("common.error.operationFailed"))),
    });
  };

  const confirmDelete = () => {
    deleteIssue.mutate({ projectId, issueId }, {
      onSuccess: () => {
        setDeleteOpen(false);
        onClose({ deleted: true });
      },
      onError: (err) => {
        setError(errorMessage(err, t("common.error.deleteFailed")));
        setDeleteOpen(false);
      },
    });
  };

  const permissions = useMemo(() => {
    if (!issue || !user)
      return { canEditAll: false, canEditStatus: false, canDelete: false };
    const isCreator = issue.creatorId === user.id;
    const isAssignee = issue.assigneeId === user.id;
    const canEditAll = isAdmin || canManage || isCreator;
    return {
      canEditAll,
      canEditStatus: canEditAll || isAssignee,
      canDelete: canEditAll,
    };
  }, [issue, user, isAdmin, canManage]);

  const canUploadAttachment = !!issue && (permissions.canEditAll || issue.assigneeId === user?.id);

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (issue && trimmed && trimmed !== issue.title)
      patch({ title: trimmed });
    else if (issue)
      setTitleDraft(issue.title);
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (!issue)
      return;
    const next = descDraft;
    const current = issue.description ?? "";
    if (next !== current)
      patch(next.trim() ? { description: next } : { description: null });
    setEditingDesc(false);
  };

  const cancelDesc = () => {
    setDescDraft(issue?.description ?? "");
    setEditingDesc(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      const target = e.target as HTMLElement;
      const isEditable = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isEditable) {
        target.blur();
        e.stopPropagation();
      }
      else if (variant === "drawer") {
        onClose();
      }
    }
  };

  if (issueQuery.isLoading && !issue)
    return <CenteredHint>{t("common.loading")}</CenteredHint>;

  if (!issue)
    return <CenteredHint tone="destructive">{error ?? t("common.error.loadFailed")}</CenteredHint>;

  const creatorName = userNames.get(issue.creatorId) ?? issue.creatorId;
  const assigneeLabel = issue.assigneeMemberId ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId : null;

  // Quiet meta tile styling, shared by the four fields in the zen meta grid.
  const tileClass = "min-w-0 rounded-lg border bg-card px-3 py-2.5";
  const tileLabelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col bg-background outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Action bar — title and fields live in the zen content column below. */}
      <div className="flex items-center gap-1 px-3 py-2 shrink-0">
        {variant === "fullscreen" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onClose()}
            className="-ml-1 gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("backToList")}
          </Button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {canUploadAttachment && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => fileInputRef.current?.click()}
              title={t("attachments.upload")}
              disabled={upload.isPending}
            >
              <Paperclip className="size-4" />
            </Button>
          )}
          {permissions.canDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDeleteOpen(true)}
              title={t("common.delete")}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
          {variant === "drawer" && onMaximize && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onMaximize}
              title={t("openFullPage")}
            >
              <Maximize2 className="size-4" />
            </Button>
          )}
          {variant === "drawer" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onClose()}
              title={t("common.close")}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => handleUpload(e.target.files)}
        />
      </div>

      {/* Body — zen-mode centered reading column */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn("mx-auto flex w-full flex-col gap-6 px-5 pb-12 pt-1", variant === "fullscreen" ? "max-w-3xl sm:px-8 sm:pt-4" : "")}>
          <ErrorBanner message={error} />

          {/* Title block: status / priority chips + the issue title */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {permissions.canEditStatus
                ? (
                    <Select value={issue.status} onValueChange={v => v !== null && patch({ status: v as typeof issue.status })}>
                      <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3">
                        <Badge variant={statusVariants[issue.status]} className="cursor-pointer">
                          {t(`status${statusKey(issue.status)}`)}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map(s => (
                          <SelectItem key={s} value={s}>{t(`status${statusKey(s)}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                : <Badge variant={statusVariants[issue.status]}>{t(`status${statusKey(issue.status)}`)}</Badge>}

              {permissions.canEditAll
                ? (
                    <Select value={issue.priority} onValueChange={v => v !== null && patch({ priority: v as typeof issue.priority })}>
                      <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3">
                        <Badge variant={priorityVariants[issue.priority]} className="cursor-pointer">
                          {t(`priority${priorityKey(issue.priority)}`)}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map(p => (
                          <SelectItem key={p} value={p}>{t(`priority${priorityKey(p)}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                : <Badge variant={priorityVariants[issue.priority]}>{t(`priority${priorityKey(issue.priority)}`)}</Badge>}
            </div>

            {editingTitle && permissions.canEditAll
              ? (
                  <input
                    className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none border-b-2 border-primary sm:text-2xl"
                    value={titleDraft}
                    autoFocus
                    onChange={e => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTitle();
                      }
                      else if (e.key === "Escape") {
                        setTitleDraft(issue.title);
                        setEditingTitle(false);
                      }
                    }}
                  />
                )
              : (
                  <h1
                    className={cn("text-xl font-semibold leading-snug tracking-tight sm:text-2xl", permissions.canEditAll && "cursor-pointer hover:text-primary")}
                    onClick={() => permissions.canEditAll && startEditTitle()}
                    title={permissions.canEditAll ? t("clickToEditTitle") : issue.title}
                  >
                    {issue.title}
                  </h1>
                )}
          </div>

          {/* Meta grid — quiet, evenly spaced fields */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className={tileClass}>
              <div className={tileLabelClass}>{t("field.assignee")}</div>
              <div className="mt-1 text-sm">
                {permissions.canEditAll
                  ? (
                      <Select
                        value={issue.assigneeMemberId ?? "__none__"}
                        onValueChange={(v) => {
                          if (v === null)
                            return;
                          patch({ assigneeMemberId: v === "__none__" ? null : v });
                        }}
                      >
                        <SelectTrigger className="h-auto w-full border-0 bg-transparent p-0 shadow-none gap-1 text-sm text-foreground hover:text-primary [&>svg:last-child]:size-3">
                          <SelectValue>
                            {(v: string) => {
                              if (v === "__none__")
                                return <span className="text-muted-foreground">{t("unassigned")}</span>;
                              return memberLabels.get(v) ?? v;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{t("unassigned")}</SelectItem>
                          {members.map(m => (
                            <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  : <span className={assigneeLabel ? "" : "text-muted-foreground"}>{assigneeLabel ?? t("unassigned")}</span>}
              </div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("field.dueDate")}</div>
              <div className="mt-1 text-sm">
                {permissions.canEditAll
                  ? (
                      <span className="relative inline-flex items-center">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="-mx-1 h-auto gap-1 px-1 text-sm font-normal text-foreground hover:text-primary"
                          onClick={() => dueDateInputRef.current?.showPicker()}
                        >
                          {issue.dueDate ?? (
                            <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                              {t("notSet")}
                              <Pencil className="size-2.5" />
                            </span>
                          )}
                        </Button>
                        <input
                          ref={dueDateInputRef}
                          type="date"
                          className="sr-only"
                          tabIndex={-1}
                          value={issue.dueDate ?? ""}
                          onChange={e => patch({ dueDate: e.target.value || null })}
                        />
                      </span>
                    )
                  : <span className={issue.dueDate ? "" : "text-muted-foreground"}>{issue.dueDate ?? "—"}</span>}
              </div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("col.creator")}</div>
              <div className="mt-1 truncate text-sm" title={creatorName}>{creatorName}</div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("col.createdAt")}</div>
              <div className="mt-1 text-sm">{formatDateTime(issue.createdAt)}</div>
            </div>
          </div>

          <div className="-mt-3 text-right text-[11px] text-muted-foreground/70">
            {t("updatedAt")}
            {" "}
            {formatDateTime(issue.updatedAt)}
          </div>

          {/* Description */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className={tileLabelClass}>{t("field.description")}</h2>
              {permissions.canEditAll && !editingDesc && issue.description && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-muted-foreground"
                  onClick={startEditDesc}
                >
                  <Pencil className="size-3" />
                  {t("common.edit")}
                </Button>
              )}
            </div>
            {editingDesc && permissions.canEditAll
              ? (
                  <div key="description-edit" className="space-y-2">
                    <MarkdownEditor
                      value={descDraft}
                      onChange={setDescDraft}
                      placeholder={t("field.descriptionPlaceholder")}
                      minHeight={200}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={cancelDesc}>
                        {t("common.cancel")}
                      </Button>
                      <Button size="sm" onClick={saveDesc}>
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                )
              : issue.description
                ? (
                    <div key="description-readonly" className="text-sm leading-relaxed">
                      <MarkdownEditor value={issue.description} readOnly />
                    </div>
                  )
                : permissions.canEditAll
                  ? (
                      <button
                        type="button"
                        onClick={startEditDesc}
                        className="w-full rounded-md bg-muted/20 px-3 py-6 text-center text-sm italic text-muted-foreground leading-snug transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t("field.noDescription")}
                      </button>
                    )
                  : (
                      <div className="text-sm italic text-muted-foreground leading-snug">
                        {t("field.noDescription")}
                      </div>
                    )}
          </section>

          <ResourceFooterSections
            resource={`projects/${projectId}/issues`}
            resourceId={issue.id}
            i18nNs="issues"
            userMap={userMap}
            commentsEnableReply
            sectionSpacingClassName="mt-2"
            canDeleteAttachment={att => !!isAdmin || issue.creatorId === user?.id || att.uploadedBy === user?.id}
            canDeleteComment={c => !!isAdmin || c.authorId === user?.id}
          />
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteTitle")}
        description={t("deleteConfirm", { title: issue.title })}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
