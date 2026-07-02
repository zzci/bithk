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
//
// The form mode lives in -contact-panel-form.tsx; the shared leaf pieces
// (props contract, sections, fields, avatar) in -contact-panel-shared.tsx.

import type { ContactPanelProps } from "./-contact-panel-shared";
import type { ContactOrganizationSummary, ContactSensitivity } from "@/shared/lib/api/contacts";
import { Edit3, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { TagChips } from "@/shared/components/tags";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { CONTACT_CONFIDENTIAL_BADGE, CONTACT_VISIBILITY_BADGE } from "@/shared/lib/status-colors";
import { isMasked, sensitivityOf } from "./-contact-form-logic";
import {
  CONTACT_KIND_LABEL_KEY,
  CONTACT_SENSITIVITY_LABEL_KEY,
  CONTACT_STATUS_LABEL_KEY,
} from "./-contact-labels";
import { ContactPanelForm } from "./-contact-panel-form";
import { ContactAvatar, ContactFieldValue, PanelSection, ViewField } from "./-contact-panel-shared";

export { ContactFieldValue } from "./-contact-panel-shared";

// Badge color per collapsed sensitivity state; confidential reuses the warning
// marker, public/private reuse the visibility chip colors.
const SENSITIVITY_BADGE_CLASS: Record<ContactSensitivity, string> = {
  public: CONTACT_VISIBILITY_BADGE.public,
  private: CONTACT_VISIBILITY_BADGE.private,
  confidential: CONTACT_CONFIDENTIAL_BADGE,
};

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
  const status = contact.status ? t(CONTACT_STATUS_LABEL_KEY[contact.status]) : null;
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
          <Badge variant="outline">{t(CONTACT_KIND_LABEL_KEY[contact.kind])}</Badge>
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
                  {t(CONTACT_SENSITIVITY_LABEL_KEY[sensitivity])}
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
