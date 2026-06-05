// Unified create / view / edit panel for a contact, rendered inside the shared
// ResizableDrawer by the contacts list route. One component drives all three
// modes so the transition view -> edit (and the "new contact" entry) happens
// in-place without a separate Dialog.
//
// Contacts are a two-kind party model: `individual` people (position, employer,
// email) and `organization` units (tax id, address). A kind selector heads the
// create form and is read-only on edit (kind is immutable). The form is sectioned
// per kind; view mode mirrors the same grouping as a scannable detail. Masking
// (isMasked / ContactFieldValue) is preserved for confidential public reads.
// Stays inside the locked stack — shadcn/ui + @base-ui/react + Tailwind only.

import type { ContactFormState } from "./-contact-form-logic";
import type { ContactKind, ContactOrganizationSummary, ContactSensitivity, ContactStatus, ContactView } from "@/shared/lib/api/contacts";
import { Building2, Edit3, Lock, Share2, Trash2, Upload, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { FileUploadButton } from "@/shared/components/file";
import { TagChips, TagInput } from "@/shared/components/tags";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { useRemoveContactAvatar, useSetContactAvatar } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { CONTACT_CONFIDENTIAL_BADGE, CONTACT_VISIBILITY_BADGE } from "@/shared/lib/status-colors";
import { ContactAttributesEditor } from "./-contact-attributes-editor";
import {
  CONTACT_KINDS,
  CONTACT_SENSITIVITIES,
  CONTACT_STATUSES,
  contactFormFromView,
  EMPTY_CONTACT_FORM,
  isMasked,
  sensitivityOf,
} from "./-contact-form-logic";
import { ContactOrgCombobox } from "./-contact-org-combobox";

type ContactPanelMode = "create" | "view" | "edit";

const CATEGORY_NONE = "__none__";

// Badge color per collapsed sensitivity state; confidential reuses the warning
// marker, public/private reuse the visibility chip colors.
const SENSITIVITY_BADGE_CLASS: Record<ContactSensitivity, string> = {
  public: CONTACT_VISIBILITY_BADGE.public,
  private: CONTACT_VISIBILITY_BADGE.private,
  confidential: CONTACT_CONFIDENTIAL_BADGE,
};

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
  /** Open the linked organization in the drawer (view mode, individuals only). */
  readonly onOpenOrganization?: (orgId: string) => void;
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
  onOpenOrganization,
}: ContactPanelProps) {
  const { t } = useTranslation(["contacts", "common"]);
  const categoriesQuery = useContactCategories();

  if (!contact)
    return null;

  const locked = isMasked(contact);
  const sensitivity = sensitivityOf(contact.visibility, contact.confidential);
  const status = contact.status ? t(`status.${contact.status}` as const) : null;
  const categoryName = contact.categoryId
    ? (categoriesQuery.data ?? []).find(c => c.id === contact.categoryId)?.name ?? contact.categoryId
    : null;
  const attributes = Object.entries(contact.attributes ?? {});

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
        <div className="flex items-center gap-4">
          <ContactAvatar kind={contact.kind} src={contact.avatarUrl} name={contact.name} className="size-14" />
          <Badge variant="outline">{t(`kind.${contact.kind}` as const)}</Badge>
        </div>

        <PanelSection title={t("drawer.details")}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @sm:grid-cols-2">
            {contact.kind === "individual" && (
              <ViewField label={t("field.position")} value={contact.position} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            )}
            <ViewField label={t("field.phone")} value={contact.phone} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <ViewField label={t("field.email")} value={contact.email} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <ViewField label={t("field.website")} value={contact.website} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <ViewField label={t("field.taxId")} value={contact.taxId} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            <div className="@sm:col-span-2">
              <ViewField label={t("field.address")} value={contact.address} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
            </div>
          </dl>
        </PanelSection>

        {contact.kind === "individual" && contact.organization && (
          <CompanyInfoSection
            organization={contact.organization}
            {...(onOpenOrganization ? { onOpenOrganization } : {})}
          />
        )}

        {attributes.length > 0 && (
          <PanelSection title={t("field.attributes")}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @sm:grid-cols-2">
              {attributes.map(([key, value]) => (
                <div key={key} className="space-y-0.5">
                  <dt className="text-xs font-medium break-words text-muted-foreground">{key}</dt>
                  <dd className="text-sm break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </PanelSection>
        )}

        <PanelSection title={t("drawer.classification")}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @sm:grid-cols-2">
            <div className="space-y-1.5">
              <dt className="text-xs font-medium text-muted-foreground">{t("sensitivity.label")}</dt>
              <dd>
                <Badge variant="secondary" className={SENSITIVITY_BADGE_CLASS[sensitivity]}>
                  {t(`sensitivity.${sensitivity}` as const)}
                </Badge>
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
                        <TagChips tags={contact.tags} variant="outline" />
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
  errorMessage: formError,
  onSubmit,
  onCancel,
}: ContactPanelProps) {
  const { t } = useTranslation(["contacts", "common"]);
  const [form, setForm] = useState<ContactFormState>(EMPTY_CONTACT_FORM);

  /* eslint-disable react/set-state-in-effect -- seed the form when the drawer opens or its target/mode changes. */
  useEffect(() => {
    setForm(mode === "edit" && contact ? contactFormFromView(contact) : EMPTY_CONTACT_FORM);
  }, [mode, contact]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // CREATE requires a name AND at least one reachable channel (phone or email);
  // EDIT stays name-only to match the backend update schema.
  const needsContactMethod = mode === "create" && !form.phone.trim() && !form.email.trim();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || needsContactMethod || pending)
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
        {formError && <ErrorBanner message={formError} />}

        <PanelSection title={t("form.sections.identity")}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t("form.kindLabel")}</Label>
              {mode === "create"
                ? (
                    <RadioGroup
                      className="flex-row gap-4"
                      aria-label={t("form.kindLabel")}
                      value={form.kind}
                      onValueChange={(value) => {
                        if (value === "individual" || value === "organization")
                          set("kind", value);
                      }}
                    >
                      {CONTACT_KINDS.map(k => (
                        <RadioGroupItem key={k} value={k}>
                          <span className="text-sm">{t(`kind.${k}` as const)}</span>
                        </RadioGroupItem>
                      ))}
                    </RadioGroup>
                  )
                : (
                    <span>
                      <Badge variant="outline">{t(`kind.${form.kind}` as const)}</Badge>
                    </span>
                  )}
            </div>

            <ContactAvatar
              kind={form.kind}
              contactId={contact?.id ?? null}
              avatarUrl={contact?.avatarUrl ?? null}
              name={form.name}
              editable
            />

            <FieldInput
              id="contact-name"
              label={t("field.name")}
              value={form.name}
              onChange={value => set("name", value)}
              placeholder={t("form.namePlaceholder")}
              autoFocus
              required
            />
          </div>
        </PanelSection>

        <PanelSection title={t("drawer.details")}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
              {form.kind === "individual" && (
                <FieldInput id="contact-position" label={t("field.position")} value={form.position} onChange={value => set("position", value)} />
              )}
              <FieldInput id="contact-phone" label={t("field.phone")} value={form.phone} onChange={value => set("phone", value)} />
              <FieldInput id="contact-email" label={t("field.email")} type="email" value={form.email} onChange={value => set("email", value)} />
              <FieldInput id="contact-website" label={t("field.website")} value={form.website} onChange={value => set("website", value)} />
              <FieldInput id="contact-taxId" label={t("field.taxId")} value={form.taxId} onChange={value => set("taxId", value)} />
            </div>
            {mode === "create" && (
              <p className="text-xs text-muted-foreground">{t("form.contactMethodRequired")}</p>
            )}
            <FieldInput id="contact-address" label={t("field.address")} value={form.address} onChange={value => set("address", value)} />
            {form.kind === "individual" && (
              <ContactOrgCombobox
                organizationId={form.organizationId}
                organizationName={form.organizationName}
                organizationAttributes={form.organizationAttributes}
                onOrganizationAttributesChange={next => set("organizationAttributes", next)}
                onPick={org => setForm(prev => ({ ...prev, organizationId: org.id, organizationName: org.name }))}
                onCreate={name => setForm(prev => ({ ...prev, organizationId: null, organizationName: name }))}
                onClear={() => setForm(prev => ({ ...prev, organizationId: null, organizationName: "" }))}
              />
            )}
          </div>
        </PanelSection>

        <PanelSection title={t("field.attributes")}>
          <ContactAttributesEditor value={form.attributes} onChange={rows => set("attributes", rows)} />
        </PanelSection>

        <PanelSection title={t("drawer.classification")}>
          <div className="flex flex-col gap-4">
            <CategoryField value={form.categoryId} onChange={id => set("categoryId", id)} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-tags">{t("field.tags")}</Label>
              <TagInput value={form.tags} onChange={tags => set("tags", [...tags])} namespace="contacts" />
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
                <Label>{t("sensitivity.label")}</Label>
                <Select value={form.sensitivity} onValueChange={v => v !== null && set("sensitivity", v as ContactSensitivity)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(`sensitivity.${v}` as const)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_SENSITIVITIES.map(s => (
                      <SelectItem key={s} value={s}>{t(`sensitivity.${s}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
        <Button type="submit" disabled={pending || !form.name.trim() || needsContactMethod}>
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

function FieldInput({
  id,
  label,
  value,
  onChange,
  type,
  placeholder,
  autoFocus,
  required,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoFocus={autoFocus}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
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

// Read-only company card for an individual's linked organization. The embedded
// summary is already masked server-side (sensitive fields nulled), so fields are
// never locked here; the name is always present. When `onOpenOrganization` is
// supplied the name becomes a link that opens the org in the drawer.
function CompanyInfoSection({
  organization,
  onOpenOrganization,
}: {
  readonly organization: ContactOrganizationSummary;
  readonly onOpenOrganization?: (orgId: string) => void;
}) {
  const { t } = useTranslation(["contacts"]);
  return (
    <PanelSection title={t("company.title")}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @sm:grid-cols-2">
        <div className="space-y-0.5 @sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">{t("field.organization")}</dt>
          <dd className="text-sm">
            {onOpenOrganization
              ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm font-normal"
                    onClick={() => onOpenOrganization(organization.id)}
                  >
                    {organization.name}
                  </Button>
                )
              : <span className="break-words text-foreground">{organization.name}</span>}
          </dd>
        </div>
        <ViewField label={t("field.website")} value={organization.website} locked={false} lockedLabel="" hiddenLabel="" />
        <ViewField label={t("field.email")} value={organization.email} locked={false} lockedLabel="" hiddenLabel="" />
        <ViewField label={t("field.phone")} value={organization.phone} locked={false} lockedLabel="" hiddenLabel="" />
        <ViewField label={t("field.taxId")} value={organization.taxId} locked={false} lockedLabel="" hiddenLabel="" />
        <div className="@sm:col-span-2">
          <ViewField label={t("field.address")} value={organization.address} locked={false} lockedLabel="" hiddenLabel="" />
        </div>
      </dl>
    </PanelSection>
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

// ── Avatar / logo ──

// Read-only avatar (view mode) when `editable` is false; an upload/replace/remove
// control (edit mode) when true. The upload mutations need a saved contact id, so
// in create mode (no id) the control is disabled with a hint. Holds a local
// preview so a fresh upload/removal shows immediately without re-fetching the
// drawer's contact snapshot.
function ContactAvatar({
  kind,
  src,
  name,
  contactId,
  avatarUrl,
  editable,
  className,
}: {
  readonly kind: ContactKind;
  readonly name: string;
  readonly src?: string | null;
  readonly contactId?: string | null;
  readonly avatarUrl?: string | null;
  readonly editable?: boolean;
  readonly className?: string;
}) {
  const { t } = useTranslation(["contacts", "common"]);
  const setAvatar = useSetContactAvatar();
  const removeAvatar = useRemoveContactAvatar();
  const [preview, setPreview] = useState<string | null>(editable ? avatarUrl ?? null : src ?? null);

  /* eslint-disable react/set-state-in-effect -- re-seed the preview when the target contact changes. */
  useEffect(() => {
    setPreview(editable ? avatarUrl ?? null : src ?? null);
  }, [editable, avatarUrl, src, contactId]);
  /* eslint-enable react/set-state-in-effect */

  const initial = name.trim() ? name.trim().slice(0, 1).toUpperCase() : null;
  const fallback = kind === "organization"
    ? <Building2 className="size-5" aria-hidden="true" />
    : initial ?? <User className="size-5" aria-hidden="true" />;

  const picture = (
    <Avatar size="lg" className={className ?? "size-16"}>
      {preview ? <AvatarImage src={preview} alt="" /> : null}
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );

  if (!editable)
    return picture;

  const pending = setAvatar.isPending || removeAvatar.isPending;
  const error = setAvatar.error
    ? errorMessage(setAvatar.error, t("common:common.error.operationFailed"))
    : removeAvatar.error
      ? errorMessage(removeAvatar.error, t("common:common.error.operationFailed"))
      : null;
  const fieldLabel = kind === "organization" ? t("avatar.logoLabel") : t("avatar.photoLabel");

  const handlePick = (files: File[]) => {
    const file = files[0];
    if (!file || !contactId)
      return;
    setAvatar.mutate({ id: contactId, file }, { onSuccess: data => setPreview(data.avatarUrl) });
  };

  const handleRemove = () => {
    if (!contactId)
      return;
    removeAvatar.mutate(contactId, { onSuccess: () => setPreview(null) });
  };

  return (
    <div className="space-y-2">
      <Label>{fieldLabel}</Label>
      {error && <ErrorBanner message={error} />}
      <div className="flex items-center gap-4">
        {picture}
        <div className="flex flex-col gap-2">
          <FileUploadButton accept="image" disabled={pending || !contactId} onSelect={handlePick}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || !contactId}
            >
              <Upload aria-hidden="true" />
              {preview ? t("avatar.replace") : t("avatar.upload")}
            </Button>
          </FileUploadButton>
          {preview && contactId && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleRemove}>
              <Trash2 className="text-destructive" aria-hidden="true" />
              {t("avatar.remove")}
            </Button>
          )}
          {!contactId && <p className="text-xs text-muted-foreground">{t("avatar.createHint")}</p>}
        </div>
      </div>
    </div>
  );
}
