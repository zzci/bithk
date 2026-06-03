// Unified create / view / edit panel for a contact, rendered inside the shared
// ResizableDrawer by the contacts list route. One component drives all three
// modes so the transition view -> edit (and the "new contact" entry) happens
// in-place without a separate Dialog.
//
// Layout follows the project drawer idiom: a sticky identity/title header, a
// scrollable sectioned body, and a sticky footer for actions. View mode is a
// scannable label-over-value detail; edit/create is a sectioned form sharing
// the same grouping. Masking (isMasked / ContactFieldValue) is preserved for
// confidential public reads. Stays inside the locked stack — shadcn/ui +
// @base-ui/react + Tailwind tokens only.

import type { ContactFormState } from "./-contact-form-logic";
import type { ContactStatus, ContactView, ContactVisibility } from "@/shared/lib/api/contacts";
import { Edit3, Lock, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { CONTACT_CONFIDENTIAL_BADGE, CONTACT_VISIBILITY_BADGE } from "@/shared/lib/status-colors";
import { addTag, removeTag } from "@/shared/lib/tag-utils";
import {
  CONTACT_STATUSES,
  CONTACT_VISIBILITIES,
  contactFormFromView,
  EMPTY_CONTACT_FORM,
  isMasked,
} from "./-contact-form-logic";

type ContactPanelMode = "create" | "view" | "edit";

const TEXT_FIELDS = ["contactPerson", "phone", "email", "address", "taxId"] as const;
const CATEGORY_NONE = "__none__";

/**
 * Renders a contact field value, the lock placeholder for masked reads, or an
 * em dash when simply empty. Shared by the list grid and this panel's view.
 */
export function ContactFieldValue({
  value,
  locked,
  lockedLabel,
  hiddenLabel,
}: {
  readonly value: string | null;
  readonly locked: boolean;
  readonly lockedLabel: string;
  readonly hiddenLabel: string;
}) {
  if (value)
    return <span className="break-words text-foreground">{value}</span>;
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" aria-label={lockedLabel}>
        <Lock className="size-3.5" />
        <span aria-hidden="true">{hiddenLabel}</span>
        <span className="sr-only">{lockedLabel}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

interface ContactPanelProps {
  readonly mode: ContactPanelMode;
  readonly contact: ContactView | null;
  readonly pending: boolean;
  readonly errorMessage: string | null;
  readonly lockedLabel: string;
  readonly hiddenLabel: string;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onShare: () => void;
  readonly onDelete: () => void;
  /** Commit a view-mode inline title rename (name only). Form mode ignores it. */
  readonly onRename: (name: string) => void;
  readonly onSubmit: (state: ContactFormState) => void;
  /** Cancel the form: edit returns to view of the same contact, create closes the drawer. */
  readonly onCancel: () => void;
}

export function ContactPanel(props: ContactPanelProps) {
  if (props.mode === "view")
    return <ContactPanelView {...props} />;
  return <ContactPanelForm {...props} />;
}

// ── View ──

function ContactPanelView({
  contact,
  lockedLabel,
  hiddenLabel,
  onClose,
  onEdit,
  onShare,
  onDelete,
  onRename,
}: ContactPanelProps) {
  const { t } = useTranslation(["contacts", "common"]);
  const categoriesQuery = useContactCategories();

  if (!contact)
    return null;

  const locked = isMasked(contact);
  const status = contact.status ? t(`status.${contact.status}` as const) : null;
  const categoryName = contact.categoryId
    ? (categoriesQuery.data ?? []).find(c => c.id === contact.categoryId)?.name ?? contact.categoryId
    : null;

  return (
    <div className="flex h-full flex-col bg-background outline-none">
      <DetailPanelHeader
        variant="drawer"
        title={contact.name}
        {...(contact.canManage
          ? { titleEdit: { canEdit: true, onSave: (next: string) => onRename(next) } }
          : {})}
        labels={{ close: t("common:common.close"), delete: t("common:common.delete") }}
        onClose={onClose}
        {...(contact.canManage ? { onDelete } : {})}
        {...(contact.canManage
          ? {
              extraActions: (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("common:common.edit")}
                    title={t("common:common.edit")}
                    onClick={onEdit}
                  >
                    <Edit3 className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("share.title")}
                    title={t("share.title")}
                    onClick={onShare}
                  >
                    <Share2 className="size-4" />
                  </Button>
                </>
              ),
            }
          : {})}
      />

      <div className="@container flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <PanelSection title={t("drawer.contactMethods")}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @sm:grid-cols-2">
            <ViewField label={t("field.contactPerson")} value={contact.contactPerson} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <ViewField label={t("field.phone")} value={contact.phone} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <ViewField label={t("field.email")} value={contact.email} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <ViewField label={t("field.taxId")} value={contact.taxId} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <div className="@sm:col-span-2">
              <ViewField label={t("field.address")} value={contact.address} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            </div>
          </dl>
        </PanelSection>

        <PanelSection title={t("drawer.classification")}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @sm:grid-cols-2">
            <div className="space-y-1.5">
              <dt className="text-xs font-medium text-muted-foreground">{t("field.visibility")}</dt>
              <dd>
                <Badge variant="secondary" className={CONTACT_VISIBILITY_BADGE[contact.visibility]}>
                  {t(`visibility.${contact.visibility}` as const)}
                </Badge>
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-xs font-medium text-muted-foreground">{t("field.confidential")}</dt>
              <dd>
                {contact.confidential
                  ? <Badge variant="secondary" className={CONTACT_CONFIDENTIAL_BADGE}>{t("field.confidential")}</Badge>
                  : <span className="text-sm text-muted-foreground">—</span>}
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-xs font-medium text-muted-foreground">{t("field.status")}</dt>
              <dd>
                {status
                  ? <Badge variant="outline">{status}</Badge>
                  : <span className="text-sm text-muted-foreground">—</span>}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs font-medium text-muted-foreground">{t("field.category")}</dt>
              <dd className="text-sm">
                {categoryName ?? <span className="text-muted-foreground">{t("category.none")}</span>}
              </dd>
            </div>
            <div className="space-y-1.5 @sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">{t("field.tags")}</dt>
              <dd>
                {contact.tags.length > 0
                  ? (
                      <div className="flex flex-wrap gap-1.5">
                        {contact.tags.map(tag => (
                          <Badge key={tag.id} variant="outline">{tag.name}</Badge>
                        ))}
                      </div>
                    )
                  : <span className="text-sm text-muted-foreground">—</span>}
              </dd>
            </div>
          </dl>
        </PanelSection>

        <PanelSection title={t("field.note")}>
          <div className="text-sm leading-relaxed">
            <ContactFieldValue value={contact.note} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
          </div>
        </PanelSection>
      </div>
    </div>
  );
}

// ── Create / Edit form ──

function ContactPanelForm({
  mode,
  contact,
  pending,
  errorMessage,
  onSubmit,
  onCancel,
}: ContactPanelProps) {
  const { t } = useTranslation(["contacts", "common"]);
  const [form, setForm] = useState<ContactFormState>(EMPTY_CONTACT_FORM);
  const [tagDraft, setTagDraft] = useState("");

  /* eslint-disable react/set-state-in-effect -- seed the form when the drawer opens or its target/mode changes. */
  useEffect(() => {
    setForm(mode === "edit" && contact ? contactFormFromView(contact) : EMPTY_CONTACT_FORM);
    setTagDraft("");
  }, [mode, contact]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const commitTag = (raw: string) => {
    set("tags", addTag(form.tags, raw));
    setTagDraft("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || pending)
      return;
    onSubmit(form);
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col bg-background outline-none">
      <DetailPanelHeader
        variant="drawer"
        title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
        labels={{ close: t("common:common.close") }}
        onClose={onCancel}
      />

      <div className="@container flex-1 space-y-7 overflow-y-auto px-5 py-5">
        {errorMessage && <ErrorBanner message={errorMessage} />}

        <PanelSection title={t("form.sections.identity")}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-name">{t("field.name")}</Label>
            <Input
              id="contact-name"
              autoFocus
              required
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder={t("form.namePlaceholder")}
            />
          </div>
        </PanelSection>

        <PanelSection title={t("drawer.contactMethods")}>
          <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
            {TEXT_FIELDS.map(key => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`contact-${key}`}>{t(`field.${key}` as const)}</Label>
                <Input
                  id={`contact-${key}`}
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </PanelSection>

        <PanelSection title={t("drawer.classification")}>
          <div className="flex flex-col gap-4">
            <CategoryField value={form.categoryId} onChange={id => set("categoryId", id)} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-tags">{t("field.tags")}</Label>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs">
                      {tag}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("tags.remove", { name: tag })}
                        onClick={() => set("tags", removeTag(form.tags, tag))}
                        className="rounded-sm hover:text-destructive"
                      >
                        <X data-icon="inline" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                id="contact-tags"
                value={tagDraft}
                onChange={e => setTagDraft(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    commitTag(tagDraft);
                  }
                  else if (event.key === "Backspace" && tagDraft === "" && form.tags.length > 0) {
                    set("tags", removeTag(form.tags, form.tags[form.tags.length - 1]!));
                  }
                }}
                onBlur={() => {
                  if (tagDraft.trim())
                    commitTag(tagDraft);
                }}
                placeholder={t("tags.placeholder")}
              />
            </div>
          </div>
        </PanelSection>

        <PanelSection title={t("form.sections.access")}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>{t("field.status")}</Label>
                <Select value={form.status} onValueChange={v => v !== null && set("status", v as ContactStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(`status.${v}` as const)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{t(`status.${s}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("field.visibility")}</Label>
                <Select value={form.visibility} onValueChange={v => v !== null && set("visibility", v as ContactVisibility)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(`visibility.${v}` as const)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_VISIBILITIES.map(v => (
                      <SelectItem key={v} value={v}>{t(`visibility.${v}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="contact-confidential">{t("field.confidential")}</Label>
                <p className="text-xs text-muted-foreground">{t("form.confidentialHelp")}</p>
              </div>
              <Switch
                id="contact-confidential"
                checked={form.confidential}
                onCheckedChange={value => set("confidential", value)}
              />
            </div>
          </div>
        </PanelSection>

        <PanelSection title={t("field.note")}>
          <Textarea
            id="contact-note"
            value={form.note}
            onChange={e => set("note", e.target.value)}
            rows={3}
            aria-label={t("field.note")}
          />
        </PanelSection>
      </div>

      <footer className="flex justify-end gap-2 border-t border-border/60 px-5 py-3 shrink-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || !form.name.trim()}>
          {mode === "create" ? t("form.submitCreate") : t("form.submitSave")}
        </Button>
      </footer>
    </form>
  );
}

// ── Shared bits ──

function PanelSection({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ViewField({
  label,
  value,
  locked,
  lockedLabel,
  hiddenLabel,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly locked: boolean;
  readonly lockedLabel: string;
  readonly hiddenLabel: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        <ContactFieldValue value={value} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
      </dd>
    </div>
  );
}

function CategoryField({
  value,
  onChange,
}: {
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation(["contacts"]);
  const categoriesQuery = useContactCategories();
  const categories = categoriesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t("field.category")}</Label>
      <Select
        value={value ?? CATEGORY_NONE}
        onValueChange={v => v !== null && onChange(v === CATEGORY_NONE ? null : v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("category.placeholder")}>
            {(v: string) => (v === CATEGORY_NONE ? t("category.none") : categories.find(c => c.id === v)?.name ?? v)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CATEGORY_NONE}>{t("category.none")}</SelectItem>
          {categories.map(category => (
            <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
