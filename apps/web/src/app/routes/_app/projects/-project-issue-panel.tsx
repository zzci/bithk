// Project work-order detail panel. A 1:1 port of the access issue panel
// (`portal/issues/-issue-panel.tsx`), adapted only for project nesting:
// assignment is member-based (`project_members.id`), reads/writes go through the
// project-scoped issue hooks, and attachments/comments resolve under
// `projects/{projectId}/issues`. Mounted as a drawer from the Issues tab and as
// a fullscreen page at `/projects/$projectId/issues/$issueId/full`.

import type { ProjectIssueRow, ProjectMemberView, UpdateProjectIssueInput } from "@/shared/lib/api/projects";
import { ClipboardList } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { DetailDescription } from "@/shared/components/detail-description";
import {
  DetailMetaRow,
  MetaActions,
  MetaAssignee,
  MetaDueDate,
  MetaSelectBadge,
  MetaSeparator,
} from "@/shared/components/detail-meta-row";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { FavoriteToggle } from "@/shared/components/favorite-toggle";
import { PRIORITY_BADGE_VARIANT } from "@/shared/components/priority-variant";
import {
  AttachFromDriveButton,
  ResourceFooterSections,
  useResourceAttachmentUpload,
  validateAttachmentSelection,
} from "@/shared/components/resource";
import { TagInput } from "@/shared/components/tags";
import { Badge } from "@/shared/components/ui/badge";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useFavoriteSet, useToggleFavorite } from "@/shared/lib/api/favorites";
import {
  useDeleteProjectIssue,
  useIssueReferences,
  useIssueTags,
  useProjectIssue,
  useUpdateProjectIssue,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

// ── Helpers ──

// Priority label key — issue priorities map to the `priority{Level}` keys in the
// issues namespace. The priority→Badge-variant map is shared with the
// procurement panel via `PRIORITY_BADGE_VARIANT`.
function priorityKey(p: string) {
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
  /** True when the caller has `issue.manage` (can create/edit/delete/pin). */
  readonly canManage: boolean;
  /** True when the caller has `issue.comment` (can post comments). */
  readonly canComment?: boolean;
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
  canComment = true,
  variant,
  onClose,
  onMaximize,
}: ProjectIssuePanelProps) {
  const { t } = useTranslation(["issues", "projects"]);
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const issueQuery = useProjectIssue(projectId, issueId);
  const issueTagsQuery = useIssueTags();
  const referencesQuery = useIssueReferences(issueId);
  const updateIssue = useUpdateProjectIssue();
  const deleteIssue = useDeleteProjectIssue();
  const favorites = useFavoriteSet();
  const toggleFavorite = useToggleFavorite();
  const issue: ProjectIssueRow | null = issueQuery.data ?? null;

  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
  const startEditDesc = () => {
    setDescDraft(issue?.description ?? "");
    setEditingDesc(true);
  };

  const { upload, fileInputRef, limits, attachmentCount } = useResourceAttachmentUpload({
    resource: `projects/${projectId}/issues`,
    resourceId: issueId,
    onError: err => setError(errorMessage(err, t("common.error.uploadFailed"))),
  });

  const handleUpload = (files: File[]) => {
    if (files.length === 0 || upload.isPending)
      return;
    setError(null);
    const validation = validateAttachmentSelection(files, attachmentCount, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (validation === "limit") {
      setError(t("attachments.limitReached"));
      return;
    }
    if (validation === "size") {
      setError(t("attachments.fileTooLarge"));
      return;
    }
    upload.mutate(files);
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

  const issueTags = issue.tags ?? [];
  const tagVocabulary = (issueTagsQuery.data ?? []).map(tag => tag.name);
  const currentTagNames = issueTags.map(tag => tag.name);
  const worklistReferences = (referencesQuery.data ?? []).filter(ref => ref.refType === "worklist");

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col bg-background outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <DetailPanelHeader
        variant={variant}
        title={issue.title}
        {...(permissions.canEditAll
          ? { titleEdit: { canEdit: true, onSave: (next: string) => patch({ title: next }), editHint: t("clickToEditTitle") } }
          : {})}
        labels={{
          back: t("backToList"),
          maximize: t("openFullPage"),
          close: t("common.close"),
          delete: t("common.delete"),
        }}
        onClose={onClose}
        extraActions={(
          <FavoriteToggle
            favorited={favorites.has("issue", issue.id)}
            pending={toggleFavorite.isPending}
            onToggle={willFavorite => toggleFavorite.mutate({ targetType: "issue", id: issue.id, favorite: willFavorite })}
          />
        )}
        {...(variant === "drawer" && onMaximize ? { onMaximize } : {})}
        {...(permissions.canDelete ? { onDelete: () => setDeleteOpen(true) } : {})}
      />

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-2">
        <ErrorBanner message={error} />

        {/* Meta row */}
        <DetailMetaRow>
          {/* Status — uses the project status colors + taxonomy labels so the
              detail badge matches the issues list and the rest of the app. */}
          <MetaSelectBadge
            canEdit={permissions.canEditStatus}
            value={issue.status}
            options={STATUSES}
            renderLabel={s => t(`projects:issues.status.${s}` as const)}
            variant="secondary"
            badgeClassName={ISSUE_STATUS_BADGE[issue.status]}
            onValueChange={v => patch({ status: v })}
          />

          {/* Priority */}
          <MetaSelectBadge
            canEdit={permissions.canEditAll}
            value={issue.priority}
            options={PRIORITIES}
            renderLabel={p => t(`priority${priorityKey(p)}`)}
            variant={PRIORITY_BADGE_VARIANT[issue.priority]}
            onValueChange={v => patch({ priority: v })}
          />

          <MetaSeparator />

          {/* Assignee — project member picker */}
          <MetaAssignee
            label={t("field.assignee")}
            unassignedLabel={t("unassigned")}
            canEdit={permissions.canEditAll}
            value={issue.assigneeMemberId}
            members={members}
            memberLabels={memberLabels}
            onChange={next => patch({ assigneeMemberId: next })}
          />

          <MetaSeparator />

          {/* Due date */}
          <MetaDueDate
            label={t("field.dueDate")}
            notSetLabel={t("notSet")}
            canEdit={permissions.canEditAll}
            value={issue.dueDate}
            onChange={next => patch({ dueDate: next })}
          />

          <MetaActions
            canUpload={canUploadAttachment}
            uploadPending={upload.isPending}
            uploadLabel={t("attachments.upload")}
            uploadingLabel={t("attachments.uploading")}
            showEdit={permissions.canEditAll && !editingDesc}
            editLabel={t("common.edit")}
            onEditClick={startEditDesc}
            fileInputRef={fileInputRef}
            onFilesSelected={handleUpload}
          />
          {canUploadAttachment && (
            <AttachFromDriveButton
              resource={`projects/${projectId}/issues`}
              resourceId={issueId}
              onError={err => setError(errorMessage(err, t("common.error.uploadFailed")))}
            />
          )}
        </DetailMetaRow>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          {permissions.canEditAll
            ? (
                <TagInput
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
        <DetailDescription
          canEdit={permissions.canEditAll}
          editing={editingDesc}
          value={issue.description ?? null}
          draft={descDraft}
          placeholder={t("field.descriptionPlaceholder")}
          noDescriptionLabel={t("field.noDescription")}
          saveLabel={t("common.save")}
          cancelLabel={t("common.cancel")}
          onDraftChange={setDescDraft}
          onStartEdit={startEditDesc}
          onSave={saveDesc}
          onCancel={cancelDesc}
        />

        {/* Referenced worklists — surfaces a work order's worklist references.
            Degrades to the raw refId when the soft reference is dangling. */}
        {worklistReferences.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {worklistReferences.map(ref => (
              <div key={ref.id} className="flex items-center gap-1.5 text-sm">
                <ClipboardList aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{`${t("projects:issues.worklist.referenced")}:`}</span>
                <span className="truncate text-foreground">{ref.worklist?.name ?? ref.refId}</span>
              </div>
            ))}
          </div>
        )}

        {/* Creator + timestamps — subtle footer-style strip above the
            attachments section, right-aligned and toned down so it
            reads as auxiliary info rather than primary content. */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground/80">
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
          commentsLocked={!canComment}
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
