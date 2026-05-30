/* eslint-disable react-refresh/only-export-components */
// Project work-order detail panel. A 1:1 port of the access issue panel
// (`portal/issues/-issue-panel.tsx`), adapted only for project nesting:
// assignment is member-based (`project_members.id`), reads/writes go through the
// project-scoped issue hooks, and attachments/comments resolve under
// `projects/{projectId}/issues`. Mounted as a drawer from the Issues tab and as
// a fullscreen page at `/projects/$projectId/issues/$issueId/full`.

import type { UpdateProjectIssueInput } from "./-project-issue-hooks";
import type { ProjectIssueRow, ProjectMemberView } from "@/shared/lib/api/projects";
import {
  ArrowLeft,
  ChevronDown,
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
import { useIssueTags } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";
import {
  useDeleteProjectIssue,
  useProjectIssue,
  useUpdateProjectIssue,
} from "./-project-issue-hooks";
import { ProjectTagsCombobox } from "./-project-tags-combobox";

// ── Helpers ──

// Priority badge variants — kept in sync with the issues list so the same
// priority reads identically across the tab and the detail panel.
export const priorityVariants: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};

export function priorityKey(p: string) {
  const map: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
  return map[p] ?? p;
}

const STATUSES = ["todo", "working", "review", "done", "cancel"] as const;
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
  const { t } = useTranslation(["issues", "projects"]);
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const issueQuery = useProjectIssue(projectId, issueId);
  const issueTagsQuery = useIssueTags();
  const updateIssue = useUpdateProjectIssue();
  const deleteIssue = useDeleteProjectIssue();
  const issue: ProjectIssueRow | null = issueQuery.data ?? null;

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

  // Drafts are seeded when entering edit mode (so an in-flight patch that
  // refreshes `issue` never clobbers what the user is typing); the read views
  // always render straight from `issue`.
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
    if (issue && trimmed && trimmed !== issue.title) {
      patch({ title: trimmed });
    }
    else if (issue) {
      setTitleDraft(issue.title);
    }
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
  const assigneeLabel = issue.assigneeMemberId
    ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
    : null;

  const issueTags = issue.tags ?? [];
  const tagVocabulary = (issueTagsQuery.data ?? []).map(tag => tag.name);
  const currentTagNames = issueTags.map(tag => tag.name);

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col bg-background outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 shrink-0">
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
        <div className="min-w-0 flex-1">
          {editingTitle && permissions.canEditAll
            ? (
                <input
                  className="w-full bg-transparent text-base font-semibold tracking-tight outline-none border-b-2 border-primary"
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
                  className={`truncate text-base font-semibold tracking-tight ${permissions.canEditAll ? "cursor-pointer hover:text-primary" : ""}`}
                  onClick={() => permissions.canEditAll && startEditTitle()}
                  title={permissions.canEditAll ? t("clickToEditTitle") : issue.title}
                >
                  {issue.title}
                </h1>
              )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
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
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-2">
        <ErrorBanner message={error} />

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {/* Status — uses the project status colors + taxonomy labels so the
              detail badge matches the issues list and the rest of the app. */}
          {permissions.canEditStatus
            ? (
                <Select value={issue.status} onValueChange={v => v !== null && patch({ status: v as typeof issue.status })}>
                  <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3">
                    <Badge variant="secondary" className={cn("cursor-pointer", ISSUE_STATUS_BADGE[issue.status])}>
                      {t(`projects:issues.group.${issue.status}` as const)}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{t(`projects:issues.group.${s}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            : <Badge variant="secondary" className={ISSUE_STATUS_BADGE[issue.status]}>{t(`projects:issues.group.${issue.status}` as const)}</Badge>}

          {/* Priority */}
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

          <span className="mx-1 text-muted-foreground/50">·</span>

          {/* Assignee — project member picker */}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>
              {t("field.assignee")}
              :
            </span>
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
                    <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 text-xs text-foreground hover:text-primary [&>svg:last-child]:size-3">
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
              : (
                  <span className="text-foreground">
                    {assigneeLabel ?? t("unassigned")}
                  </span>
                )}
          </span>

          <span className="mx-1 text-muted-foreground/50">·</span>

          {/* Due date */}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>
              {t("field.dueDate")}
              :
            </span>
            {permissions.canEditAll
              ? (
                  <span className="relative inline-flex items-center">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-foreground hover:text-primary"
                      onClick={() => dueDateInputRef.current?.showPicker()}
                      aria-label={t("field.dueDate")}
                      title={t("field.dueDate")}
                    >
                      {issue.dueDate
                        ? <span>{issue.dueDate}</span>
                        : <span className="text-muted-foreground">{t("notSet")}</span>}
                      <ChevronDown className="size-3" />
                    </button>
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
              : <span className="text-foreground">{issue.dueDate ?? "—"}</span>}
          </span>

          <div className="ml-auto inline-flex items-center gap-0.5">
            {canUploadAttachment && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => fileInputRef.current?.click()}
                title={t("attachments.upload")}
              >
                <Paperclip className="size-3" />
                {upload.isPending ? t("attachments.uploading") : t("attachments.upload")}
              </button>
            )}
            {permissions.canEditAll && !editingDesc && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={startEditDesc}
              >
                <Pencil className="size-3" />
                {t("common.edit")}
              </button>
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

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          {permissions.canEditAll
            ? (
                <ProjectTagsCombobox
                  value={currentTagNames}
                  suggestions={tagVocabulary}
                  onChange={next => patch({ tags: [...next] })}
                />
              )
            : issueTags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="gap-1 text-xs font-normal">
                  {tag.name}
                </Badge>
              ))}
        </div>

        {/* Description */}
        <div className="rounded-md bg-muted/40 p-3">
          {editingDesc && permissions.canEditAll
            ? (
                <div key="description-edit" className="space-y-2">
                  <MarkdownEditor
                    value={descDraft}
                    onChange={setDescDraft}
                    placeholder={t("field.descriptionPlaceholder")}
                    minHeight={160}
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
                      className="w-full rounded-md border border-dashed bg-transparent px-2 py-1 text-left text-sm italic text-muted-foreground leading-snug hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      {t("field.noDescription")}
                    </button>
                  )
                : (
                    <div className="rounded-md border border-dashed bg-transparent px-2 py-1 text-sm italic text-muted-foreground leading-snug">
                      {t("field.noDescription")}
                    </div>
                  )}
        </div>

        {/* Creator + timestamps — subtle footer-style strip above the
            attachments section, right-aligned and toned down so it
            reads as auxiliary info rather than primary content. */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-muted-foreground/80">
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{t("col.creator")}</span>
            <span className="text-foreground/70">{creatorName}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{t("col.createdAt")}</span>
            <span className="text-foreground/70">{formatDateTime(issue.createdAt)}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{t("updatedAt")}</span>
            <span className="text-foreground/70">{formatDateTime(issue.updatedAt)}</span>
          </span>
        </div>

        <ResourceFooterSections
          resource={`projects/${projectId}/issues`}
          resourceId={issue.id}
          i18nNs="issues"
          userMap={userMap}
          commentsEnableReply
          commentsEnableAttachments
          commentsStickyComposer
          currentUserId={user?.id}
          sectionSpacingClassName="mt-4"
          canDeleteAttachment={att => !!isAdmin || issue.creatorId === user?.id || att.uploadedBy === user?.id}
          canDeleteCommentAttachment={att => !!isAdmin || att.uploadedBy === user?.id}
          canDeleteComment={c => !!isAdmin || c.authorId === user?.id}
        />
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
