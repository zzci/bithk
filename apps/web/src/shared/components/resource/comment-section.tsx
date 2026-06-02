/* eslint-disable react-refresh/only-export-components */
// Generic comments UI for any resource exposing
// `/api/{resource}/{id}/comments`. Supports two opt-in features:
//
//   - `enableReply`: shows a reply button on each comment; replies are
//     flat (no nesting) and surfaced as a clickable badge that scrolls
//     to the referenced comment.
//   - `locked`: replaces the composer with a notice and rejects new
//     comments. Used by docs comment moderation.

import type { ResourceAttachment } from "./attachment-section";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, CornerUpLeft, Lock, Paperclip, Send, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownEditor } from "@/shared/components/editor";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useUploadLimits } from "@/shared/hooks/use-upload-limits";
import { errorMessage } from "@/shared/lib/errors";
import { http } from "@/shared/lib/http";
import { displayName } from "@/shared/lib/users";
import { cn } from "@/shared/lib/utils";

import { ResourceAttachmentSection } from "./attachment-section";
import { validateAttachmentSelection } from "./attachment-upload";
import { useResourceAttachmentUpload } from "./use-attachment-upload";

export interface ResourceComment {
  readonly id: string;
  readonly authorId: string;
  readonly content: string;
  readonly replyToId?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResourceUser {
  readonly id: string;
  readonly name: string;
}

export function commentsQueryKey(resource: string, resourceId: string) {
  return [resource, resourceId, "comments"] as const;
}

// A long thread mounts one full markdown renderer per comment. Cap the
// initial render to the newest slice and reveal the rest progressively so
// a 100+ comment thread doesn't mount everything at once. (`@tanstack/
// react-virtual` isn't a dependency, so true windowing is out of scope.)
const COMMENTS_INITIAL_RENDER = 20;

function useFormatTimeAgo(i18nNs: string) {
  const { t } = useTranslation(i18nNs);
  return (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1)
      return t("comments.justNow");
    if (minutes < 60)
      return t("comments.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
      return t("comments.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return t("comments.daysAgo", { count: days });
  };
}

export interface ResourceCommentSectionProps {
  /** Path prefix, e.g. "documents" or "issues". */
  readonly resource: string;
  readonly resourceId: string;
  readonly userMap: Map<string, ResourceUser>;
  readonly canDelete: (c: ResourceComment) => boolean;
  readonly i18nNs: string;
  /** Show a "locked" notice instead of the composer. */
  readonly locked?: boolean;
  /** Show a reply button + clickable replyTo badges. */
  readonly enableReply?: boolean;
  /** List + upload + delete per-comment attachments. Off by default. */
  readonly enableAttachments?: boolean;
  /** Current actor id — gates the per-comment upload control to the author. */
  readonly currentUserId?: string | undefined;
  /** Delete predicate for comment attachments (mirrors the backend rule). */
  readonly canDeleteAttachment?: ((att: ResourceAttachment) => boolean) | undefined;
  /**
   * Opt-in: pin the composer to the bottom of the scroll container (comment
   * list scrolls above it). Off by default so shared consumers (procurement,
   * documents) keep the composer-at-top layout unchanged.
   */
  readonly stickyComposer?: boolean;
}

export function ResourceCommentSection({
  resource,
  resourceId,
  userMap,
  canDelete,
  i18nNs,
  locked = false,
  enableReply = false,
  enableAttachments = false,
  currentUserId,
  canDeleteAttachment,
  stickyComposer = false,
}: ResourceCommentSectionProps) {
  const { t } = useTranslation(i18nNs);
  const qc = useQueryClient();
  const formatTimeAgo = useFormatTimeAgo(i18nNs);
  const [newComment, setNewComment] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [replyTarget, setReplyTarget] = useState<ResourceComment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResourceComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const composerFileInputRef = useRef<HTMLInputElement>(null);
  const limits = useUploadLimits();
  const composerRef = useRef<HTMLDivElement>(null);
  const commentNodesRef = useRef(new Map<string, HTMLDivElement>());
  const [flashId, setFlashId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(COMMENTS_INITIAL_RENDER);

  const commentsQuery = useQuery({
    queryKey: commentsQueryKey(resource, resourceId),
    queryFn: () => http<{ data: ResourceComment[] }>(`/${resource}/${resourceId}/comments`).then(r => r.data),
  });
  const allComments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);
  const commentById = useMemo(
    () => new Map(allComments.map(c => [c.id, c])),
    [allComments],
  );
  // Render only the newest `visibleCount` (tail of the chronological list);
  // the rest stay collapsed behind a "show older" button.
  const hiddenCount = Math.max(0, allComments.length - visibleCount);
  const visibleComments = hiddenCount > 0 ? allComments.slice(hiddenCount) : allComments;

  const submit = useMutation({
    mutationFn: async (input: { content: string; replyToId: string | null; files: File[] }) => {
      const payload: Record<string, unknown> = enableReply
        ? { content: input.content, replyToId: input.replyToId }
        : { content: input.content };
      if (enableAttachments && input.files.length > 0)
        payload.hasAttachments = true;
      const res = await http<{ data: ResourceComment }>(`/${resource}/${resourceId}/comments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      for (const file of input.files) {
        const fd = new FormData();
        fd.append("file", file);
        await http(`/${resource}/${resourceId}/comments/${res.data.id}/attachments`, { method: "POST", body: fd });
      }
    },
    onSuccess: () => {
      setNewComment("");
      setReplyTarget(null);
      setPendingFiles([]);
      setEditorKey(k => k + 1);
    },
    onError: err => setError(errorMessage(err, t("common.error.operationFailed"))),
    // Invalidate on settle (not only success): a created comment must still
    // appear even if an attachment upload fails partway through.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: commentsQueryKey(resource, resourceId) });
    },
  });

  const handlePickPending = (files: FileList | null) => {
    if (!files || files.length === 0)
      return;
    setError(null);
    const selected = Array.from(files);
    const v = validateAttachmentSelection(selected, pendingFiles.length, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (v === "limit") {
      setError(t("attachments.limitReached"));
      if (composerFileInputRef.current)
        composerFileInputRef.current.value = "";
      return;
    }
    if (v === "size") {
      setError(t("attachments.fileTooLarge"));
      if (composerFileInputRef.current)
        composerFileInputRef.current.value = "";
      return;
    }
    setPendingFiles(prev => [...prev, ...selected]);
    if (composerFileInputRef.current)
      composerFileInputRef.current.value = "";
  };

  const remove = useMutation({
    mutationFn: async (c: ResourceComment) => {
      await http(`/${resource}/${resourceId}/comments/${c.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: commentsQueryKey(resource, resourceId) });
    },
    onError: err => setError(errorMessage(err, t("common.error.deleteFailed"))),
  });

  const startReply = (target: ResourceComment) => {
    setReplyTarget(target);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const jumpToComment = (id: string) => {
    // The target may be in the collapsed-older range — reveal everything so
    // its ref mounts, then scroll on the next frame once it's painted.
    if (!commentById.has(id))
      return;
    const scrollToEl = () => {
      const el = commentNodesRef.current.get(id);
      if (!el)
        return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(id);
      window.setTimeout(() => setFlashId(prev => (prev === id ? null : prev)), 1500);
    };
    if (commentNodesRef.current.has(id)) {
      scrollToEl();
      return;
    }
    setVisibleCount(allComments.length);
    requestAnimationFrame(() => requestAnimationFrame(scrollToEl));
  };

  const canCompose = !locked;

  // Shared composer body — rendered either at the top (default) or pinned to
  // the bottom inside the sticky wrapper (opt-in), never both.
  const composerInner = (
    <>
      {enableReply && replyTarget && (
        <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="shrink-0">{t("comments.replyingTo")}</span>
            <span className="truncate text-foreground/80">
              {displayName(userMap, replyTarget.authorId)}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-2"
            onClick={() => setReplyTarget(null)}
            title={t("common.cancel")}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}
      <MarkdownEditor
        key={editorKey}
        onChange={md => setNewComment(md)}
        compact
        placeholder={t("comments.placeholder")}
        minHeight={60}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {enableAttachments && pendingFiles.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {pendingFiles.map((file, i) => (
                <span
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="inline-flex max-w-[180px] items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  <span className="truncate">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-4"
                    onClick={() => setPendingFiles(f => f.filter((_, j) => j !== i))}
                    title={t("common.delete")}
                  >
                    <X className="size-3" />
                  </Button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {enableAttachments && (
            <>
              <Button
                variant="ghost"
                size="icon"
                title={t("attachments.upload")}
                onClick={() => composerFileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <input
                ref={composerFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => handlePickPending(e.target.files)}
              />
            </>
          )}
          <Button
            disabled={submit.isPending || (!newComment.trim() && pendingFiles.length === 0)}
            onClick={() => submit.mutate({ content: newComment.trim(), replyToId: replyTarget?.id ?? null, files: pendingFiles })}
          >
            <Send className="size-3.5 mr-1.5" />
            {t("comments.send")}
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div>
      <ErrorBanner message={error} className="mb-3" />

      {!canCompose && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" />
          <span>{t("comments.lockedNotice")}</span>
        </div>
      )}

      {canCompose && !stickyComposer && (
        <div ref={composerRef} className="mb-4 space-y-2">
          {composerInner}
        </div>
      )}

      <div className="space-y-3">
        {commentsQuery.isLoading
          ? <div className="text-sm text-muted-foreground text-center py-4">{t("common.loading")}</div>
          : allComments.length === 0
            ? <div className="text-sm text-muted-foreground text-center py-4">{t("comments.noComments")}</div>
            : (
                <>
                  {hiddenCount > 0 && (
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setVisibleCount(c => c + COMMENTS_INITIAL_RENDER)}
                      >
                        <ChevronUp className="size-3" />
                        {t("comments.showOlder", { count: hiddenCount })}
                      </Button>
                    </div>
                  )}
                  {visibleComments.map((comment) => {
                    const parent = enableReply && comment.replyToId ? commentById.get(comment.replyToId) : null;
                    return (
                      <div
                        key={comment.id}
                        ref={(el) => {
                          if (el)
                            commentNodesRef.current.set(comment.id, el);
                          else
                            commentNodesRef.current.delete(comment.id);
                        }}
                        className={cn(
                          "group transition-colors",
                          flashId === comment.id && "bg-primary/5 -mx-2 px-2 py-2 rounded-md",
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium">
                              {displayName(userMap, comment.authorId)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatTimeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <div className="inline-flex items-center gap-1">
                            {enableReply && canCompose && (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-[11px] text-muted-foreground/70 hover:text-foreground"
                                onClick={() => startReply(comment)}
                              >
                                <CornerUpLeft className="size-3" />
                                {t("comments.reply")}
                              </Button>
                            )}
                            {canDelete(comment) && (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-[11px] text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setDeleteTarget(comment)}
                              >
                                <X className="size-3" />
                                {t("common.delete")}
                              </Button>
                            )}
                          </div>
                        </div>
                        {enableReply && comment.replyToId && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="mb-1 max-w-full bg-muted/30 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            onClick={() => jumpToComment(comment.replyToId!)}
                            title={parent ? parent.content : undefined}
                          >
                            <CornerUpLeft className="size-3 shrink-0" />
                            {parent
                              ? (
                                  <span className="truncate">
                                    {displayName(userMap, parent.authorId)}
                                    <span className="mx-1 text-muted-foreground/50">·</span>
                                    {parent.content.replace(/\s+/g, " ").slice(0, 60)}
                                  </span>
                                )
                              : <span>{t("comments.replyMissing")}</span>}
                          </Button>
                        )}
                        {comment.content.trim() && (
                          <div className="rounded-md bg-muted/40 px-3 py-2">
                            <MarkdownEditor
                              defaultValue={comment.content}
                              readOnly
                              className="text-sm"
                            />
                          </div>
                        )}
                        {enableAttachments && (
                          <CommentAttachments
                            resource={resource}
                            resourceId={resourceId}
                            comment={comment}
                            i18nNs={i18nNs}
                            canUpload={!!currentUserId && comment.authorId === currentUserId}
                            canDeleteAttachment={canDeleteAttachment}
                          />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
      </div>

      {canCompose && stickyComposer && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border/60 bg-background px-4 py-2">
          <div ref={composerRef} className="space-y-2">
            {composerInner}
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("comments.deleteTitle")}
        description={t("comments.deleteConfirm")}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  );
}

// Per-comment attachment block. Lives in its own component so the upload
// hook runs once per comment (hooks can't run in the comment-map loop).
// Resolves under `${resource}/${resourceId}/comments/{commentId}/attachments`,
// matching the backend's `item_comment_attachment` routes.
function CommentAttachments({
  resource,
  resourceId,
  comment,
  i18nNs,
  canUpload,
  canDeleteAttachment,
}: {
  readonly resource: string;
  readonly resourceId: string;
  readonly comment: ResourceComment;
  readonly i18nNs: string;
  readonly canUpload: boolean;
  readonly canDeleteAttachment?: ((att: ResourceAttachment) => boolean) | undefined;
}) {
  const { t } = useTranslation(i18nNs);
  const [error, setError] = useState<string | null>(null);
  const commentResource = `${resource}/${resourceId}/comments`;

  const { upload, fileInputRef, limits, attachmentCount } = useResourceAttachmentUpload({
    resource: commentResource,
    resourceId: comment.id,
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

  return (
    <div className="mt-1.5 space-y-1.5">
      <ErrorBanner message={error} />
      <ResourceAttachmentSection
        resource={commentResource}
        resourceId={comment.id}
        i18nNs={i18nNs}
        canDelete={canDeleteAttachment ?? (() => false)}
      />
      {canUpload && (
        <div>
          <Button
            type="button"
            variant="ghost"
            className="h-auto gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => fileInputRef.current?.click()}
            title={t("attachments.upload")}
          >
            <Paperclip className="size-3" />
            {upload.isPending ? t("attachments.uploading") : t("attachments.upload")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
