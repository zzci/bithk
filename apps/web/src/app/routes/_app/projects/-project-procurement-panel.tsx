// Procurement detail panel. Mounted as a drawer from the project Procurement
// tab and as a fullscreen page at `/projects/$projectId/procurements/$id/full`.
// A 1:1 port of `-project-issue-panel.tsx` for interaction + layout parity
// (flat header, inline meta row, markdown description, ResourceFooterSections),
// adapted only for the procurement field set (supplier / category / quantity /
// amount / currency) and the procurement status set. Procurement is
// non-deletable, so — unlike the issue panel — there is no delete affordance,
// and status changes go through the dedicated status endpoint (not PATCH).

import type { ProcurementPriority, ProcurementStatus, UpdateProcurementInput } from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import {
  ArrowLeft,
  ChevronDown,
  Maximize2,
  Paperclip,
  Pencil,
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
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useContacts } from "@/shared/lib/api/contacts";
import {
  PROCUREMENT_PRIORITIES,
  PROCUREMENT_STATUSES,
  useChangeProcurementStatus,
  useProcurement,
  useProcurementTags,
  useUpdateProcurement,
} from "@/shared/lib/api/procurement";
import { useProcurementCategories } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { PROCUREMENT_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";
import { ProjectTagsCombobox } from "./-project-tags-combobox";

// ── Helpers ──

// Priority badge variants — kept in sync with the issues panel so the same
// priority reads identically across the procurement tab and the detail panel.
const PRIORITY_VARIANTS: Record<ProcurementPriority, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};

const NONE = "__none__";

// ── ProjectProcurementPanel ──

interface ProjectProcurementPanelProps {
  readonly projectId: string;
  readonly procurementId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  /** True when the caller has `procurement.manage`. */
  readonly canManage: boolean;
  /** True when the caller has `procurement.comment` (can post comments). */
  readonly canComment?: boolean;
  readonly variant: "drawer" | "fullscreen";
  readonly onClose: () => void;
  readonly onMaximize?: () => void;
}

export function ProjectProcurementPanel({
  projectId,
  procurementId,
  members,
  userNames,
  canManage,
  canComment = true,
  variant,
  onClose,
  onMaximize,
}: ProjectProcurementPanelProps) {
  const { t } = useTranslation(["projects", "issues", "common"]);
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";
  const canEdit = canManage || isAdmin;

  const procurementQuery = useProcurement(projectId, procurementId);
  const updateProcurement = useUpdateProcurement();
  const changeStatus = useChangeProcurementStatus();
  const suppliersQuery = useContacts();
  const categoriesQuery = useProcurementCategories(projectId);
  const procurementTagsQuery = useProcurementTags();
  const procurement = procurementQuery.data ?? null;

  const [error, setError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const suppliers = useMemo(
    () => (suppliersQuery.data ?? []).map(contact => ({ id: contact.id, name: contact.name })),
    [suppliersQuery.data],
  );
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  // ResourceFooterSections renders comment authors from a `{ id, name }` map.
  const userMap = useMemo(
    () => new Map(Array.from(userNames, ([id, name]) => [id, { id, name }])),
    [userNames],
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Drafts are seeded when entering edit mode (so an in-flight patch that
  // refreshes `procurement` never clobbers what the user is typing); the read
  // views always render straight from `procurement`.
  const startEditTitle = () => {
    if (!procurement)
      return;
    setTitleDraft(procurement.itemName);
    setEditingTitle(true);
  };
  const startEditDesc = () => {
    setDescDraft(procurement?.description ?? "");
    setEditingDesc(true);
  };

  const { upload, fileInputRef, limits, attachmentCount } = useResourceAttachmentUpload({
    resource: `projects/${projectId}/procurements`,
    resourceId: procurementId,
    onError: err => setError(errorMessage(err, t("common:common.error.uploadFailed"))),
  });

  const handleUpload = (files: FileList | null) => {
    if (!files || files.length === 0 || upload.isPending)
      return;
    setError(null);
    const selected = Array.from(files);
    const validation = validateAttachmentSelection(selected, attachmentCount, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (validation === "limit") {
      setError(t("issues:attachments.limitReached"));
      if (fileInputRef.current)
        fileInputRef.current.value = "";
      return;
    }
    if (validation === "size") {
      setError(t("issues:attachments.fileTooLarge"));
      if (fileInputRef.current)
        fileInputRef.current.value = "";
      return;
    }
    upload.mutate(selected);
  };

  const patch = (body: UpdateProcurementInput) => {
    updateProcurement.mutate({ projectId, id: procurementId, ...body }, {
      onError: err => setError(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  // Status lives on the shared item base, so it is changed via the dedicated
  // status endpoint (not the procurement PATCH, which has no status field).
  const changeProcurementStatus = (status: ProcurementStatus) => {
    changeStatus.mutate({ projectId, id: procurementId, status }, {
      onError: err => setError(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const canUploadAttachment = !!procurement && canEdit;

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (procurement && trimmed && trimmed !== procurement.itemName)
      patch({ itemName: trimmed });
    else if (procurement)
      setTitleDraft(procurement.itemName);
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (!procurement)
      return;
    const next = descDraft;
    const current = procurement.description ?? "";
    if (next !== current)
      patch(next.trim() ? { description: next } : { description: null });
    setEditingDesc(false);
  };

  const cancelDesc = () => {
    setDescDraft(procurement?.description ?? "");
    setEditingDesc(false);
  };

  // Commit a non-negative number from a raw inline-field string (or null when
  // emptied); reject invalid input by leaving the committed value unchanged.
  const commitNumber = (raw: string, current: number | null, apply: (next: number | null) => void) => {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0))
      return;
    if (next !== current)
      apply(next);
  };

  const commitText = (raw: string, current: string | null, apply: (next: string | null) => void) => {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== current)
      apply(next);
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

  if (procurementQuery.isLoading && !procurement)
    return <CenteredHint>{t("common:common.loading")}</CenteredHint>;

  if (!procurement)
    return <CenteredHint tone="destructive">{error ?? t("procurement.detail.loadFailed")}</CenteredHint>;

  const creatorName = userNames.get(procurement.creatorId) ?? procurement.creatorId;
  const assigneeLabel = procurement.assigneeMemberId
    ? memberLabels.get(procurement.assigneeMemberId) ?? procurement.assigneeMemberId
    : null;
  const supplierName = procurement.supplierId
    ? suppliers.find(s => s.id === procurement.supplierId)?.name ?? procurement.supplierId
    : null;
  const categoryName = procurement.categoryId
    ? categories.find(c => c.id === procurement.categoryId)?.name ?? procurement.categoryId
    : null;

  const procurementTags = procurement.tags ?? [];
  const tagVocabulary = (procurementTagsQuery.data ?? []).map(tag => tag.name);
  const currentTagNames = procurementTags.map(tag => tag.name);

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
            onClick={() => onClose()}
            className="-ml-1 gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("procurement.detail.backToList")}
          </Button>
        )}
        <div className="min-w-0 flex-1">
          {editingTitle && canEdit
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
                      setTitleDraft(procurement.itemName);
                      setEditingTitle(false);
                    }
                  }}
                />
              )
            : (
                <h1
                  className={`truncate text-base font-semibold tracking-tight ${canEdit ? "cursor-pointer rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""}`}
                  onClick={() => canEdit && startEditTitle()}
                  title={canEdit ? t("procurement.detail.clickToEditTitle") : procurement.itemName}
                  tabIndex={canEdit ? 0 : undefined}
                  onKeyDown={canEdit
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          startEditTitle();
                        }
                      }
                    : undefined}
                >
                  {procurement.itemName}
                </h1>
              )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {variant === "drawer" && onMaximize && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMaximize}
              title={t("procurement.detail.openFullPage")}
            >
              <Maximize2 className="size-4" />
            </Button>
          )}
          {variant === "drawer" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onClose()}
              title={t("common:common.close")}
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
          {/* Status — changed through the dedicated status endpoint. */}
          {canEdit
            ? (
                <Select value={procurement.status} onValueChange={v => v !== null && changeProcurementStatus(v as ProcurementStatus)}>
                  <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3" aria-label={t("procurement.changeStatus")}>
                    <Badge variant="secondary" className={cn("cursor-pointer", PROCUREMENT_STATUS_BADGE[procurement.status])}>
                      {t(`procurement.status.${procurement.status}` as const)}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {PROCUREMENT_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{t(`procurement.status.${s}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            : <Badge variant="secondary" className={PROCUREMENT_STATUS_BADGE[procurement.status]}>{t(`procurement.status.${procurement.status}` as const)}</Badge>}

          {/* Priority */}
          {canEdit
            ? (
                <Select value={procurement.priority} onValueChange={v => v !== null && patch({ priority: v as ProcurementPriority })}>
                  <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3" aria-label={t("procurement.field.priority")}>
                    <Badge variant={PRIORITY_VARIANTS[procurement.priority]} className="cursor-pointer">
                      {t(`procurement.priority.${procurement.priority}` as const)}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {PROCUREMENT_PRIORITIES.map(p => (
                      <SelectItem key={p} value={p}>{t(`procurement.priority.${p}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            : <Badge variant={PRIORITY_VARIANTS[procurement.priority]}>{t(`procurement.priority.${procurement.priority}` as const)}</Badge>}

          <span className="mx-1 text-muted-foreground/50">·</span>

          {/* Assignee — project member picker */}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>
              {t("procurement.field.assignee")}
              :
            </span>
            {canEdit
              ? (
                  <Select
                    value={procurement.assigneeMemberId ?? NONE}
                    onValueChange={(v) => {
                      if (v === null)
                        return;
                      patch({ assigneeMemberId: v === NONE ? null : v });
                    }}
                  >
                    <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 text-xs text-foreground hover:text-primary [&>svg:last-child]:size-3">
                      <SelectValue>
                        {(v: string) => {
                          if (v === NONE)
                            return <span className="text-muted-foreground">{t("procurement.detail.unassigned")}</span>;
                          return memberLabels.get(v) ?? v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("procurement.detail.unassigned")}</SelectItem>
                      {members.map(m => (
                        <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              : (
                  <span className="text-foreground">
                    {assigneeLabel ?? t("procurement.detail.unassigned")}
                  </span>
                )}
          </span>

          <span className="mx-1 text-muted-foreground/50">·</span>

          {/* Due date */}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>
              {t("procurement.field.dueDate")}
              :
            </span>
            {canEdit
              ? (
                  <span className="relative inline-flex items-center">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded text-xs text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
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
                      }}
                      aria-label={t("procurement.field.dueDate")}
                      title={t("procurement.field.dueDate")}
                    >
                      {procurement.dueDate
                        ? <span>{procurement.dueDate}</span>
                        : <span className="text-muted-foreground">{t("procurement.detail.notSet")}</span>}
                      <ChevronDown className="size-3" />
                    </button>
                    <input
                      ref={dueDateInputRef}
                      type="date"
                      className="sr-only"
                      tabIndex={-1}
                      value={procurement.dueDate ?? ""}
                      onChange={e => patch({ dueDate: e.target.value || null })}
                    />
                  </span>
                )
              : <span className="text-foreground">{procurement.dueDate ?? "—"}</span>}
          </span>

          <div className="ml-auto inline-flex items-center gap-0.5">
            {canUploadAttachment && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => fileInputRef.current?.click()}
                title={t("issues:attachments.upload")}
              >
                <Paperclip className="size-3" />
                {upload.isPending ? t("issues:attachments.uploading") : t("issues:attachments.upload")}
              </Button>
            )}
            {canEdit && !editingDesc && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={startEditDesc}
              >
                <Pencil className="size-3" />
                {t("common:common.edit")}
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

        {/* Tags — view / add / remove, mirroring the issue panel. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit
            ? (
                <ProjectTagsCombobox
                  value={currentTagNames}
                  suggestions={tagVocabulary}
                  onChange={next => patch({ tags: [...next] })}
                />
              )
            : procurementTags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="gap-1 text-xs font-normal">
                  {tag.name}
                </Badge>
              ))}
        </div>

        {/* Procurement details — procurement-specific fields presented as a clean
            table, distinct from the generic meta row shared with issues. Inline
            edit is preserved for the editable fields. */}
        <section className="mt-1">
          <h2 className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("procurement.detail.procurementDetails")}
          </h2>
          <div className="overflow-hidden rounded-md border border-border/60">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border/60">
                <ProcurementDetailRow label={t("procurement.field.itemName")}>
                  <span className="text-foreground">{procurement.itemName}</span>
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.supplier")}>
                  {canEdit
                    ? (
                        <Select
                          value={procurement.supplierId ?? NONE}
                          onValueChange={(v) => {
                            if (v === null)
                              return;
                            patch({ supplierId: v === NONE ? null : v });
                          }}
                        >
                          <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 text-sm text-foreground hover:text-primary [&>svg:last-child]:size-3">
                            <SelectValue>
                              {(v: string) => (v === NONE ? <span className="text-muted-foreground">{t("procurement.none")}</span> : suppliers.find(s => s.id === v)?.name ?? v)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t("procurement.none")}</SelectItem>
                            {suppliers.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    : <span className="text-foreground">{supplierName ?? t("procurement.none")}</span>}
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.category")}>
                  {canEdit
                    ? (
                        <Select
                          value={procurement.categoryId ?? NONE}
                          onValueChange={(v) => {
                            if (v === null)
                              return;
                            patch({ categoryId: v === NONE ? null : v });
                          }}
                        >
                          <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 text-sm text-foreground hover:text-primary [&>svg:last-child]:size-3">
                            <SelectValue>
                              {(v: string) => (v === NONE ? <span className="text-muted-foreground">{t("procurement.none")}</span> : categories.find(c => c.id === v)?.name ?? v)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t("procurement.none")}</SelectItem>
                            {categories.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    : <span className="text-foreground">{categoryName ?? t("procurement.none")}</span>}
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.quantity")}>
                  <InlineValue
                    display={procurement.quantity === null ? null : String(procurement.quantity)}
                    initial={procurement.quantity === null ? "" : String(procurement.quantity)}
                    canEdit={canEdit}
                    type="number"
                    notSetLabel={t("procurement.detail.notSet")}
                    onCommit={raw => commitNumber(raw, procurement.quantity, next => patch({ quantity: next }))}
                  />
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.amount")}>
                  <InlineValue
                    display={procurement.amount === null ? null : String(procurement.amount)}
                    initial={procurement.amount === null ? "" : String(procurement.amount)}
                    canEdit={canEdit}
                    type="number"
                    notSetLabel={t("procurement.detail.notSet")}
                    onCommit={raw => commitNumber(raw, procurement.amount, next => patch({ amount: next }))}
                  />
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.currency")}>
                  <InlineValue
                    display={procurement.currency}
                    initial={procurement.currency ?? ""}
                    canEdit={canEdit}
                    maxLength={10}
                    notSetLabel={t("procurement.detail.notSet")}
                    onCommit={raw => commitText(raw, procurement.currency, next => patch({ currency: next }))}
                  />
                </ProcurementDetailRow>
              </tbody>
            </table>
          </div>
        </section>

        {/* Description */}
        <div className="rounded-md bg-muted/40 p-3">
          {editingDesc && canEdit
            ? (
                <div key="description-edit" className="space-y-2">
                  <MarkdownEditor
                    value={descDraft}
                    onChange={setDescDraft}
                    placeholder={t("procurement.detail.descriptionPlaceholder")}
                    minHeight={160}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={cancelDesc}>
                      {t("common:common.cancel")}
                    </Button>
                    <Button onClick={saveDesc}>
                      {t("common:common.save")}
                    </Button>
                  </div>
                </div>
              )
            : procurement.description
              ? (
                  <div key="description-readonly" className="text-sm leading-relaxed">
                    <MarkdownEditor value={procurement.description} readOnly />
                  </div>
                )
              : canEdit
                ? (
                    <button
                      type="button"
                      onClick={startEditDesc}
                      className="w-full rounded-md border border-dashed bg-transparent px-2 py-1 text-left text-sm italic text-muted-foreground leading-snug hover:bg-muted/50 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("procurement.detail.noDescription")}
                    </button>
                  )
                : (
                    <p className="text-sm italic text-muted-foreground leading-snug">
                      {t("procurement.detail.noDescription")}
                    </p>
                  )}
        </div>

        {/* Creator + timestamps — subtle footer-style strip above the
            attachments section, right-aligned and toned down so it
            reads as auxiliary info rather than primary content. */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-muted-foreground/80">
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{t("procurement.detail.creator")}</span>
            <span className="text-foreground/70">{creatorName}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{t("procurement.detail.createdAt")}</span>
            <span className="text-foreground/70">{formatDateTime(procurement.createdAt)}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{t("procurement.detail.updatedAt")}</span>
            <span className="text-foreground/70">{formatDateTime(procurement.updatedAt)}</span>
          </span>
        </div>

        <ResourceFooterSections
          resource={`projects/${projectId}/procurements`}
          resourceId={procurement.id}
          i18nNs="issues"
          userMap={userMap}
          commentsLocked={!canComment}
          commentsEnableReply
          commentsEnableAttachments
          commentsStickyComposer
          currentUserId={user?.id}
          sectionSpacingClassName="mt-4"
          canDeleteAttachment={att => !!isAdmin || procurement.creatorId === user?.id || att.uploadedBy === user?.id}
          canDeleteCommentAttachment={att => !!isAdmin || att.uploadedBy === user?.id}
          canDeleteComment={c => !!isAdmin || c.authorId === user?.id}
        />
      </div>
    </div>
  );
}

// ── Procurement-details table primitives ──

interface ProcurementDetailRowProps {
  readonly label: string;
  readonly children: React.ReactNode;
}

// One label/value row of the 采购细节 (procurement-details) table. The label is
// a row header for assistive-tech table semantics.
function ProcurementDetailRow({ label, children }: ProcurementDetailRowProps) {
  return (
    <tr>
      <th scope="row" className="w-32 px-3 py-2 text-left align-top text-xs font-normal text-muted-foreground">
        {label}
      </th>
      <td className="px-3 py-2 align-top">{children}</td>
    </tr>
  );
}

interface InlineValueProps {
  /** Formatted current value, or null when unset (shows the "not set" affordance). */
  readonly display: string | null;
  /** Initial input value when entering edit mode. */
  readonly initial: string;
  readonly canEdit: boolean;
  readonly type?: "text" | "number";
  readonly maxLength?: number;
  readonly notSetLabel: string;
  readonly onCommit: (raw: string) => void;
}

// Value-only inline edit cell for the procurement-details table (the row header
// already carries the label). A click reveals a borderless input that commits on
// blur/Enter. The input is uncontrolled and seeded from `initial`; a successful
// patch refreshes `initial`, so the next edit starts from the committed value.
function InlineValue({ display, initial, canEdit, type = "text", maxLength, notSetLabel, onCommit }: InlineValueProps) {
  const [editing, setEditing] = useState(false);

  if (!canEdit)
    return <span className="text-foreground">{display ?? "—"}</span>;

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        min={type === "number" ? "0" : undefined}
        maxLength={maxLength}
        defaultValue={initial}
        className="h-5 w-24 border-b border-primary bg-transparent text-sm text-foreground outline-none"
        onBlur={(e) => {
          onCommit(e.currentTarget.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter")
            e.currentTarget.blur();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded text-sm text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setEditing(true)}
    >
      {display ?? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          {notSetLabel}
          <Pencil className="size-2.5" />
        </span>
      )}
    </button>
  );
}
