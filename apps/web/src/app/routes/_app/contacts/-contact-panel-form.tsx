// Create / edit form mode of the contact panel, extracted from
// -contact-panel.tsx. The form is sectioned per kind (kind selector on create,
// read-only badge on edit) and reuses the shared DetailPanelHeader plus the
// section/field primitives from -contact-panel-shared.tsx.

import type { ContactFormState } from "./-contact-form-logic";
import type { ContactPanelProps } from "./-contact-panel-shared";
import type { ContactSensitivity, ContactStatus } from "@/shared/lib/api/contacts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { TagInput } from "@/shared/components/tags";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
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
import { ContactAttributesEditor } from "./-contact-attributes-editor";
import {
  CONTACT_KINDS,
  CONTACT_SENSITIVITIES,
  CONTACT_STATUSES,
  contactFormFromView,
  EMPTY_CONTACT_FORM,
} from "./-contact-form-logic";
import {
  CONTACT_KIND_LABEL_KEY,
  CONTACT_SENSITIVITY_LABEL_KEY,
  CONTACT_STATUS_LABEL_KEY,
} from "./-contact-labels";
import { ContactOrgCombobox } from "./-contact-org-combobox";
import { ContactAvatar, FieldInput, PanelSection } from "./-contact-panel-shared";

const CATEGORY_NONE = "__none__";

export function ContactPanelForm({
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
                          <span className="text-sm">{t(CONTACT_KIND_LABEL_KEY[k])}</span>
                        </RadioGroupItem>
                      ))}
                    </RadioGroup>
                  )
                : (
                    <span>
                      <Badge variant="outline">{t(CONTACT_KIND_LABEL_KEY[form.kind])}</Badge>
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
                    <SelectValue>{(v: string) => t(CONTACT_STATUS_LABEL_KEY[v as ContactStatus])}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{t(CONTACT_STATUS_LABEL_KEY[s])}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("sensitivity.label")}</Label>
                <Select value={form.sensitivity} onValueChange={v => v !== null && set("sensitivity", v as ContactSensitivity)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(CONTACT_SENSITIVITY_LABEL_KEY[v as ContactSensitivity])}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_SENSITIVITIES.map(s => (
                      <SelectItem key={s} value={s}>{t(CONTACT_SENSITIVITY_LABEL_KEY[s])}</SelectItem>
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
