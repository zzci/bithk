// Procurement detail panel. Mounted as a drawer from the project Procurement
// tab and as a fullscreen page at `/projects/$projectId/procurements/$id/full`.
// Modeled on `-project-issue-panel.tsx` for interaction parity, but with the
// procurement field set (supplier / category / quantity / amount / currency)
// and the pipeline status set. Procurement is non-deletable, so — unlike the
// issue panel — there is no delete affordance.

import type { ProcurementPriority, ProcurementStatus, UpdateProcurementInput } from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import {
  ArrowLeft,
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
import { toast } from "sonner";
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
import { Input } from "@/shared/components/ui/input";
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
  useUpdateProcurement,
} from "@/shared/lib/api/procurement";
import { useProcurementCategories } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { buildMemberLabelMap } from "./-member-helpers";

// ── Helpers ──

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
  /** True when the caller is a procurement manager or app admin. */
  readonly canManage: boolean;
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
      onSuccess: () => toast.success(t("toast.procurementUpdated")),
      onError: (err) => {
        const message = errorMessage(err, t("common:common.error.operationFailed"));
        setError(message);
        toast.error(message);
      },
    });
  };

  // Status lives on the shared item base, so it is changed via the dedicated
  // status endpoint (not the procurement PATCH, which has no status field).
  const changeProcurementStatus = (status: ProcurementStatus) => {
    changeStatus.mutate({ projectId, id: procurementId, status }, {
      onSuccess: () => toast.success(t("toast.procurementStatusChanged")),
      onError: (err) => {
        const message = errorMessage(err, t("common:common.error.operationFailed"));
        setError(message);
        toast.error(message);
      },
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
  const assigneeLabel = procurement.assigneeMemberId ? memberLabels.get(procurement.assigneeMemberId) ?? procurement.assigneeMemberId : null;
  const supplierName = procurement.supplierId ? suppliers.find(s => s.id === procurement.supplierId)?.name ?? procurement.supplierId : null;
  const categoryName = procurement.categoryId ? categories.find(c => c.id === procurement.categoryId)?.name ?? procurement.categoryId : null;

  const tileClass = "min-w-0 rounded-lg border bg-card px-3 py-2.5";
  const tileLabelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col bg-background outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Action bar */}
      <div className="flex items-center gap-1 px-3 py-2 shrink-0">
        {variant === "fullscreen" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onClose()}
            className="-ml-1 gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("procurement.detail.backToList")}
          </Button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {canUploadAttachment && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => fileInputRef.current?.click()}
              title={t("issues:attachments.upload")}
              disabled={upload.isPending}
            >
              <Paperclip className="size-4" />
            </Button>
          )}
          {variant === "drawer" && onMaximize && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onMaximize}
              title={t("procurement.detail.openFullPage")}
            >
              <Maximize2 className="size-4" />
            </Button>
          )}
          {variant === "drawer" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onClose()}
              title={t("common:common.close")}
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

          {/* Status / priority chips + the item title */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {canEdit
                ? (
                    <Select value={procurement.status} onValueChange={v => v !== null && changeProcurementStatus(v as ProcurementStatus)}>
                      <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3" aria-label={t("procurement.changeStatus")}>
                        <Badge variant="secondary" className="cursor-pointer">
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
                : <Badge variant="secondary">{t(`procurement.status.${procurement.status}` as const)}</Badge>}

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
            </div>

            {editingTitle && canEdit
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
                        setTitleDraft(procurement.itemName);
                        setEditingTitle(false);
                      }
                    }}
                  />
                )
              : (
                  <h1
                    className={cn("text-xl font-semibold leading-snug tracking-tight sm:text-2xl", canEdit && "cursor-pointer hover:text-primary")}
                    onClick={() => canEdit && startEditTitle()}
                    title={canEdit ? t("procurement.detail.clickToEditTitle") : procurement.itemName}
                  >
                    {procurement.itemName}
                  </h1>
                )}
          </div>

          {/* Meta grid — assignee / due date / creator / created */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className={tileClass}>
              <div className={tileLabelClass}>{t("procurement.field.assignee")}</div>
              <div className="mt-1 text-sm">
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
                        <SelectTrigger className="h-auto w-full border-0 bg-transparent p-0 shadow-none gap-1 text-sm text-foreground hover:text-primary [&>svg:last-child]:size-3">
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
                  : <span className={assigneeLabel ? "" : "text-muted-foreground"}>{assigneeLabel ?? t("procurement.detail.unassigned")}</span>}
              </div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("procurement.field.dueDate")}</div>
              <div className="mt-1 text-sm">
                {canEdit
                  ? (
                      <span className="relative inline-flex items-center">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="-mx-1 h-auto gap-1 px-1 text-sm font-normal text-foreground hover:text-primary"
                          onClick={() => dueDateInputRef.current?.showPicker()}
                        >
                          {procurement.dueDate ?? (
                            <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                              {t("procurement.detail.notSet")}
                              <Pencil className="size-2.5" />
                            </span>
                          )}
                        </Button>
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
                  : <span className={procurement.dueDate ? "" : "text-muted-foreground"}>{procurement.dueDate ?? "—"}</span>}
              </div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("procurement.detail.creator")}</div>
              <div className="mt-1 truncate text-sm" title={creatorName}>{creatorName}</div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("procurement.detail.createdAt")}</div>
              <div className="mt-1 text-sm">{formatDateTime(procurement.createdAt)}</div>
            </div>
          </div>

          {/* Procurement-specific fields */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className={tileClass}>
              <div className={tileLabelClass}>{t("procurement.field.supplier")}</div>
              <div className="mt-1 text-sm">
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
                        <SelectTrigger className="h-auto w-full border-0 bg-transparent p-0 shadow-none gap-1 text-sm text-foreground hover:text-primary [&>svg:last-child]:size-3">
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
                  : <span className={supplierName ? "" : "text-muted-foreground"}>{supplierName ?? t("procurement.none")}</span>}
              </div>
            </div>

            <div className={tileClass}>
              <div className={tileLabelClass}>{t("procurement.field.category")}</div>
              <div className="mt-1 text-sm">
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
                        <SelectTrigger className="h-auto w-full border-0 bg-transparent p-0 shadow-none gap-1 text-sm text-foreground hover:text-primary [&>svg:last-child]:size-3">
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
                  : <span className={categoryName ? "" : "text-muted-foreground"}>{categoryName ?? t("procurement.none")}</span>}
              </div>
            </div>

            <NumberTile
              label={t("procurement.field.quantity")}
              value={procurement.quantity}
              canEdit={canEdit}
              onCommit={next => patch({ quantity: next })}
            />

            <NumberTile
              label={t("procurement.field.amount")}
              value={procurement.amount}
              canEdit={canEdit}
              onCommit={next => patch({ amount: next })}
            />

            <TextTile
              label={t("procurement.field.currency")}
              value={procurement.currency}
              canEdit={canEdit}
              maxLength={10}
              onCommit={next => patch({ currency: next })}
            />
          </div>

          <div className="-mt-3 text-right text-[11px] text-muted-foreground/70">
            {t("procurement.detail.updatedAt")}
            {" "}
            {formatDateTime(procurement.updatedAt)}
          </div>

          {/* Description */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className={tileLabelClass}>{t("procurement.field.description")}</h2>
              {canEdit && !editingDesc && procurement.description && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-muted-foreground"
                  onClick={startEditDesc}
                >
                  <Pencil className="size-3" />
                  {t("common:common.edit")}
                </Button>
              )}
            </div>
            {editingDesc && canEdit
              ? (
                  <div key="description-edit" className="space-y-2">
                    <MarkdownEditor
                      value={descDraft}
                      onChange={setDescDraft}
                      placeholder={t("procurement.detail.descriptionPlaceholder")}
                      minHeight={200}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={cancelDesc}>
                        {t("common:common.cancel")}
                      </Button>
                      <Button size="sm" onClick={saveDesc}>
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
                        className="w-full rounded-md bg-muted/20 px-3 py-6 text-center text-sm italic text-muted-foreground leading-snug transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t("procurement.detail.noDescription")}
                      </button>
                    )
                  : (
                      <div className="text-sm italic text-muted-foreground leading-snug">
                        {t("procurement.detail.noDescription")}
                      </div>
                    )}
          </section>

          <ResourceFooterSections
            resource={`projects/${projectId}/procurements`}
            resourceId={procurement.id}
            i18nNs="issues"
            userMap={userMap}
            commentsEnableReply
            sectionSpacingClassName="mt-2"
            canDeleteAttachment={att => !!isAdmin || procurement.creatorId === user?.id || att.uploadedBy === user?.id}
            canDeleteComment={c => !!isAdmin || c.authorId === user?.id}
          />
        </div>
      </div>
    </div>
  );
}

// ── Inline-editable numeric / text tiles ──

interface NumberTileProps {
  readonly label: string;
  readonly value: number | null;
  readonly canEdit: boolean;
  readonly onCommit: (next: number | null) => void;
}

// Uncontrolled inputs keyed on the committed value: a successful patch updates
// `value`, which remounts the input with the fresh default — no effect-driven
// draft sync needed.

/** Quiet meta tile that commits a non-negative integer (or null when emptied). */
function NumberTile({ label, value, canEdit, onCommit }: NumberTileProps) {
  const initial = value === null ? "" : String(value);
  const commit = (input: HTMLInputElement) => {
    const trimmed = input.value.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      input.value = initial; // reject invalid input, restore the committed value
      return;
    }
    if (next !== value)
      onCommit(next);
  };

  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">
        {canEdit
          ? (
              <Input
                key={initial}
                type="number"
                min="0"
                defaultValue={initial}
                onBlur={e => commit(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    e.currentTarget.blur();
                }}
                className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            )
          : <span className={value === null ? "text-muted-foreground" : ""}>{value === null ? "—" : value}</span>}
      </div>
    </div>
  );
}

interface TextTileProps {
  readonly label: string;
  readonly value: string | null;
  readonly canEdit: boolean;
  readonly maxLength?: number;
  readonly onCommit: (next: string | null) => void;
}

/** Quiet meta tile that commits a trimmed string (or null when emptied). */
function TextTile({ label, value, canEdit, maxLength, onCommit }: TextTileProps) {
  const initial = value ?? "";
  const commit = (input: HTMLInputElement) => {
    const trimmed = input.value.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== value)
      onCommit(next);
  };

  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">
        {canEdit
          ? (
              <Input
                key={initial}
                defaultValue={initial}
                maxLength={maxLength}
                onBlur={e => commit(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    e.currentTarget.blur();
                }}
                className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            )
          : <span className={value ? "" : "text-muted-foreground"}>{value ?? "—"}</span>}
      </div>
    </div>
  );
}
