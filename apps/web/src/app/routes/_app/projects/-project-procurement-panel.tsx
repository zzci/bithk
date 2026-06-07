// Procurement detail panel. Mounted as a drawer from the project Procurement
// tab and as a fullscreen page at `/projects/$projectId/procurements/$id/full`.
// A 1:1 port of `-project-issue-panel.tsx` for interaction + layout parity
// (flat header, inline meta row, markdown description, ResourceFooterSections),
// adapted only for the procurement field set (supplier / category / quantity /
// amount / currency) and the procurement status set. Procurement is
// non-deletable, so — unlike the issue panel — there is no delete affordance,
// and status changes go through the dedicated status endpoint (not PATCH).

import type { ProcurementStatus, UpdateProcurementInput } from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import {
  Pencil,
} from "lucide-react";
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
import { PRIORITY_BADGE_VARIANT } from "@/shared/components/priority-variant";
import {
  ResourceFooterSections,
  useResourceAttachmentUpload,
  validateAttachmentSelection,
} from "@/shared/components/resource";
import { TagInput } from "@/shared/components/tags";
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
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

// ── Helpers ──

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
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
  const startEditDesc = () => {
    setDescDraft(procurement?.description ?? "");
    setEditingDesc(true);
  };

  const { upload, fileInputRef, limits, attachmentCount } = useResourceAttachmentUpload({
    resource: `projects/${projectId}/procurements`,
    resourceId: procurementId,
    onError: err => setError(errorMessage(err, t("common:common.error.uploadFailed"))),
  });

  const handleUpload = (files: File[]) => {
    if (files.length === 0 || upload.isPending)
      return;
    setError(null);
    const validation = validateAttachmentSelection(files, attachmentCount, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (validation === "limit") {
      setError(t("issues:attachments.limitReached"));
      return;
    }
    if (validation === "size") {
      setError(t("issues:attachments.fileTooLarge"));
      return;
    }
    upload.mutate(files);
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
      <DetailPanelHeader
        variant={variant}
        title={procurement.itemName}
        {...(canEdit
          ? { titleEdit: { canEdit: true, onSave: (next: string) => patch({ itemName: next }), editHint: t("procurement.detail.clickToEditTitle") } }
          : {})}
        labels={{
          back: t("procurement.detail.backToList"),
          maximize: t("procurement.detail.openFullPage"),
          close: t("common:common.close"),
        }}
        onClose={onClose}
        {...(variant === "drawer" && onMaximize ? { onMaximize } : {})}
      />

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-2">
        <ErrorBanner message={error} />

        {/* Meta row */}
        <DetailMetaRow>
          {/* Status — changed through the dedicated status endpoint. */}
          <MetaSelectBadge
            canEdit={canEdit}
            value={procurement.status}
            options={PROCUREMENT_STATUSES}
            renderLabel={s => t(`procurement.status.${s}` as const)}
            variant="secondary"
            badgeClassName={PROCUREMENT_STATUS_BADGE[procurement.status]}
            triggerAriaLabel={t("procurement.changeStatus")}
            onValueChange={changeProcurementStatus}
          />

          {/* Priority */}
          <MetaSelectBadge
            canEdit={canEdit}
            value={procurement.priority}
            options={PROCUREMENT_PRIORITIES}
            renderLabel={p => t(`procurement.priority.${p}` as const)}
            variant={PRIORITY_BADGE_VARIANT[procurement.priority]}
            triggerAriaLabel={t("procurement.field.priority")}
            onValueChange={v => patch({ priority: v })}
          />

          <MetaSeparator />

          {/* Assignee — project member picker */}
          <MetaAssignee
            label={t("procurement.field.assignee")}
            unassignedLabel={t("procurement.detail.unassigned")}
            canEdit={canEdit}
            value={procurement.assigneeMemberId}
            members={members}
            memberLabels={memberLabels}
            onChange={next => patch({ assigneeMemberId: next })}
          />

          <MetaSeparator />

          {/* Due date */}
          <MetaDueDate
            label={t("procurement.field.dueDate")}
            notSetLabel={t("procurement.detail.notSet")}
            canEdit={canEdit}
            value={procurement.dueDate}
            onChange={next => patch({ dueDate: next })}
          />

          <MetaActions
            canUpload={canUploadAttachment}
            uploadPending={upload.isPending}
            uploadLabel={t("issues:attachments.upload")}
            uploadingLabel={t("issues:attachments.uploading")}
            showEdit={canEdit && !editingDesc}
            editLabel={t("common:common.edit")}
            onEditClick={startEditDesc}
            fileInputRef={fileInputRef}
            onFilesSelected={handleUpload}
          />
        </DetailMetaRow>

        {/* Tags — view / add / remove, mirroring the issue panel. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit
            ? (
                <TagInput
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
        <DetailDescription
          canEdit={canEdit}
          editing={editingDesc}
          value={procurement.description ?? null}
          draft={descDraft}
          placeholder={t("procurement.detail.descriptionPlaceholder")}
          noDescriptionLabel={t("procurement.detail.noDescription")}
          saveLabel={t("common:common.save")}
          cancelLabel={t("common:common.cancel")}
          onDraftChange={setDescDraft}
          onStartEdit={startEditDesc}
          onSave={saveDesc}
          onCancel={cancelDesc}
        />

        {/* Creator + timestamps — subtle footer-style strip above the
            attachments section, right-aligned and toned down so it
            reads as auxiliary info rather than primary content. */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground/80">
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
    <Button
      type="button"
      variant="ghost"
      className="h-auto gap-1 rounded px-0 text-sm font-normal text-foreground hover:bg-transparent hover:text-primary"
      onClick={() => setEditing(true)}
    >
      {display ?? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          {notSetLabel}
          <Pencil className="size-2.5" />
        </span>
      )}
    </Button>
  );
}
