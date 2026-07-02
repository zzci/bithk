// Procurement detail panel. Mounted as a drawer from the project Procurement
// tab and as a fullscreen page at `/projects/$projectId/procurements/$id/full`.
// A 1:1 port of `-project-issue-panel.tsx` for interaction + layout parity
// (flat header, inline meta row, markdown description, ResourceFooterSections),
// adapted only for the procurement field set (supplier / category / quantity /
// amount / currency) and the procurement status set. Procurement is
// non-deletable, so — unlike the issue panel — there is no delete affordance,
// and status changes go through the dedicated status endpoint (not PATCH).

import type { ProcurementFormValues } from "./-project-procurement-form-logic";
import type { ProcurementStatus, UpdateProcurementInput } from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import {
  Lock,
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
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useContacts } from "@/shared/lib/api/contacts";
import { useFavoriteSet, useToggleFavorite } from "@/shared/lib/api/favorites";
import {
  isAllowedProcurementTransition,
  isProcurementDetailLocked,
  PROCUREMENT_PRIORITIES,
  PROCUREMENT_STATUSES,
  useChangeProcurementStatus,
  useProcurement,
  useProcurementTags,
  useUpdateProcurement,
} from "@/shared/lib/api/procurement";
import { useProcurementCategories } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime, formatMoney } from "@/shared/lib/format";
import { PROCUREMENT_STATUS_BADGE } from "@/shared/lib/status-colors";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";
import { ProcurementForm } from "./-project-procurement-form";
import {
  PROCUREMENT_FORM_NONE,
  procurementFormFromRow,
} from "./-project-procurement-form-logic";

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
  const favorites = useFavoriteSet();
  const toggleFavorite = useToggleFavorite();
  const procurement = procurementQuery.data ?? null;

  const [error, setError] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  // view → read-only detail with inline workflow edits; edit → item-detail form.
  const [mode, setMode] = useState<"view" | "edit">("view");
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

  // Save the item-detail edit form. Only the item-detail fields are sent; the
  // workflow fields stay inline in the view. A null clears the optional fields.
  const handleEditSubmit = (values: ProcurementFormValues) => {
    setError(null);
    updateProcurement.mutate({
      projectId,
      id: procurementId,
      itemName: values.itemName.trim(),
      title: values.title.trim() ? values.title.trim() : null,
      supplierId: values.supplierId === PROCUREMENT_FORM_NONE ? null : values.supplierId,
      categoryId: values.categoryId === PROCUREMENT_FORM_NONE ? null : values.categoryId,
      quantity: values.quantity.trim() === "" ? null : Number(values.quantity),
      amount: values.amount,
      currency: values.currency.trim() ? values.currency.trim() : null,
    }, {
      onSuccess: () => setMode("view"),
      onError: err => setError(errorMessage(err, t("common:common.error.operationFailed"))),
    });
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
  // Item details freeze once the procurement is paid (or beyond).
  const detailsLocked = isProcurementDetailLocked(procurement.status);
  // Status picker only offers transitions the API allows from the current status
  // (keeps the current status, since a self-transition is allowed).
  const statusOptions = PROCUREMENT_STATUSES.filter(s => isAllowedProcurementTransition(procurement.status, s));

  // Edit mode: the item-detail form replaces the whole panel (workflow fields
  // are edited inline back in the view). Keyed by id so navigating between
  // procurements re-seeds the form.
  if (mode === "edit") {
    return (
      <ProcurementForm
        key={procurementId}
        mode="edit"
        initial={procurementFormFromRow(procurement)}
        members={members}
        memberLabels={memberLabels}
        suppliers={suppliers}
        categories={categories}
        tagSuggestions={tagVocabulary}
        pending={updateProcurement.isPending}
        error={error}
        onSubmit={handleEditSubmit}
        onCancel={() => {
          setError(null);
          setMode("view");
        }}
      />
    );
  }

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
        labels={{
          back: t("procurement.detail.backToList"),
          maximize: t("procurement.detail.openFullPage"),
          close: t("common:common.close"),
        }}
        onClose={onClose}
        extraActions={(
          <FavoriteToggle
            favorited={favorites.has("procurement", procurement.id)}
            pending={toggleFavorite.isPending}
            onToggle={willFavorite => toggleFavorite.mutate({ targetType: "procurement", id: procurement.id, favorite: willFavorite })}
          />
        )}
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
            options={statusOptions}
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
          {canUploadAttachment && (
            <AttachFromDriveButton
              resource={`projects/${projectId}/procurements`}
              resourceId={procurementId}
              onError={err => setError(errorMessage(err, t("common:common.error.uploadFailed")))}
            />
          )}
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

        {/* Procurement details — procurement-specific fields, read-only. Editing
            happens in the item-detail form (the "edit details" button), which is
            hidden once the procurement is paid and its details freeze. */}
        <section className="mt-1">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              {t("procurement.detail.procurementDetails")}
            </h2>
            {canEdit && (detailsLocked
              ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                    <Lock className="size-3" aria-hidden="true" />
                    {t("procurement.detail.detailsLockedHint")}
                  </span>
                )
              : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1 px-2 py-1 text-xs font-normal text-muted-foreground hover:text-primary"
                    onClick={() => {
                      setError(null);
                      setMode("edit");
                    }}
                  >
                    <Pencil className="size-3" aria-hidden="true" />
                    {t("procurement.detail.editDetails")}
                  </Button>
                ))}
          </div>
          <div className="overflow-hidden rounded-md border border-border/60">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border/60">
                <ProcurementDetailRow label={t("procurement.field.itemName")}>
                  <span className="text-foreground">{procurement.itemName}</span>
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.supplier")}>
                  <span className="text-foreground">{supplierName ?? t("procurement.none")}</span>
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.category")}>
                  <span className="text-foreground">{categoryName ?? t("procurement.none")}</span>
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.quantity")}>
                  <span className="text-foreground">{procurement.quantity === null ? "—" : String(procurement.quantity)}</span>
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.amount")}>
                  <span className="text-foreground">{procurement.amount === null ? "—" : formatMoney(procurement.amount)}</span>
                </ProcurementDetailRow>

                <ProcurementDetailRow label={t("procurement.field.currency")}>
                  <span className="text-foreground">{procurement.currency ?? "—"}</span>
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
