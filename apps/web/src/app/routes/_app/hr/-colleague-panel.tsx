// Unified create / view / edit panel for an HR colleague, rendered inside the
// shared ResizableDrawer by the colleagues list route. One component drives all
// three modes so the transition view -> edit (and the "new colleague" entry)
// happens in-place without a separate Dialog — mirroring the contacts panel.
//
// A colleague links to exactly one unified user (real or virtual). View mode
// groups the profile metadata (personal, contact, emergency, employment,
// payment) into scannable sections and hosts the personal-document block
// (multiple uploads — passport, certificates, etc.). National ID / passport
// numbers are NOT stored as fields; they live in those uploaded documents.
// Stays inside the locked stack — shadcn/ui + @base-ui/react + Tailwind only.
//
// The form mode lives in -colleague-panel-form.tsx; the shared leaf pieces
// (props contract, section primitives) in -colleague-panel-shared.tsx.

import type { ColleaguePanelProps } from "./-colleague-panel-shared";
import { Edit3, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { FileUploadButton } from "@/shared/components/file";
import { AttachFromDriveButton } from "@/shared/components/resource/attach-from-drive-button";
import { ResourceAttachmentSection } from "@/shared/components/resource/attachment-section";
import { validateAttachmentSelection } from "@/shared/components/resource/attachment-upload";
import { useResourceAttachmentUpload } from "@/shared/components/resource/use-attachment-upload";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { HR_EMPLOYMENT_LABEL_KEY, HR_GENDER_LABEL_KEY } from "./-colleague-labels";
import { ColleaguePanelForm } from "./-colleague-panel-form";
import { PanelSection, ViewField, ViewGrid } from "./-colleague-panel-shared";
import { ColleaguePayrollSection } from "./-colleague-payroll-section";

export type { ColleaguePanelMode, ColleaguePanelProps } from "./-colleague-panel-shared";

export function ColleaguePanel(props: ColleaguePanelProps) {
  if (props.mode === "view")
    return <ColleaguePanelView {...props} />;
  return <ColleaguePanelForm {...props} />;
}

// ── View ──

function ColleaguePanelView({ colleague, onClose, onEdit, onArchive }: ColleaguePanelProps) {
  const { t } = useTranslation(["hr", "common"]);

  if (!colleague)
    return null;

  const genderLabel = colleague.gender ? t(HR_GENDER_LABEL_KEY[colleague.gender]) : null;
  const employmentLabel = colleague.employmentType
    ? t(HR_EMPLOYMENT_LABEL_KEY[colleague.employmentType])
    : null;
  const statusLabel = colleague.status === "active"
    ? t("colleagues.statusActive")
    : t("colleagues.statusArchived");

  return (
    <div className="flex h-full flex-col bg-background outline-none">
      <DetailPanelHeader
        variant="drawer"
        title={colleague.user.name}
        labels={{ close: t("common:common.close"), delete: t("colleagues.archive") }}
        onClose={onClose}
        {...(colleague.status === "active" ? { onDelete: onArchive } : {})}
        extraActions={(
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
        )}
      />

      <div className="@container flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{`@${colleague.user.username}`}</span>
          {colleague.user.isVirtual && (
            <Badge variant="outline" className="text-xs">{t("colleagues.virtualBadge")}</Badge>
          )}
          <Badge variant={colleague.status === "active" ? "default" : "secondary"}>{statusLabel}</Badge>
        </div>

        <PanelSection title={t("colleagues.section.identity")}>
          <ViewGrid>
            <ViewField label={t("colleagues.field.code")} value={colleague.code} />
            <ViewField label={t("colleagues.field.title")} value={colleague.title} />
            <ViewField label={t("colleagues.field.department")} value={colleague.department} />
            <ViewField label={t("colleagues.field.employmentType")} value={employmentLabel} />
          </ViewGrid>
        </PanelSection>

        <PanelSection title={t("colleagues.section.personal")}>
          <ViewGrid>
            <ViewField label={t("colleagues.field.gender")} value={genderLabel} />
            <ViewField label={t("colleagues.field.birthday")} value={colleague.birthday} />
            <ViewField label={t("colleagues.field.nationality")} value={colleague.nationality} />
          </ViewGrid>
        </PanelSection>

        <PanelSection title={t("colleagues.section.contact")}>
          <ViewGrid>
            <ViewField label={t("colleagues.field.personalPhone")} value={colleague.personalPhone} />
            <ViewField label={t("colleagues.field.personalEmail")} value={colleague.personalEmail} />
            <div className="@sm:col-span-2">
              <ViewField label={t("colleagues.field.address")} value={colleague.address} />
            </div>
          </ViewGrid>
        </PanelSection>

        {colleague.emergencyContacts.length > 0 && (
          <PanelSection title={t("colleagues.section.emergency")}>
            <div className="space-y-2">
              {colleague.emergencyContacts.map((contact, idx) => (
                <div key={idx} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{contact.name || "—"}</span>
                    {contact.relation && (
                      <span className="text-muted-foreground">{`(${contact.relation})`}</span>
                    )}
                  </div>
                  {(contact.phone || contact.email || contact.address) && (
                    <div className="mt-1 space-y-0.5 text-muted-foreground">
                      {contact.phone && <div>{contact.phone}</div>}
                      {contact.email && <div className="break-words">{contact.email}</div>}
                      {contact.address && <div className="break-words">{contact.address}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </PanelSection>
        )}

        <PanelSection title={t("colleagues.section.employment")}>
          <ViewGrid>
            <ViewField label={t("colleagues.field.hireDate")} value={colleague.hireDate} />
            <ViewField label={t("colleagues.field.probationEndDate")} value={colleague.probationEndDate} />
            <ViewField label={t("colleagues.field.contractEndDate")} value={colleague.contractEndDate} />
            <ViewField label={t("colleagues.field.workLocation")} value={colleague.workLocation} />
          </ViewGrid>
        </PanelSection>

        {colleague.paymentInfo.length > 0 && (
          <PanelSection title={t("colleagues.section.payment")}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @sm:grid-cols-2">
              {colleague.paymentInfo.map((field, idx) => (
                <div key={idx} className="space-y-0.5">
                  <dt className="text-xs font-medium break-words text-muted-foreground">{field.label || "—"}</dt>
                  <dd className="text-sm break-words">{field.value || "—"}</dd>
                </div>
              ))}
            </dl>
          </PanelSection>
        )}

        <ColleaguePayrollSection colleagueId={colleague.id} />

        {colleague.notes && (
          <PanelSection title={t("colleagues.field.notes")}>
            <div className="text-sm leading-relaxed break-words">{colleague.notes}</div>
          </PanelSection>
        )}

        <PanelSection title={t("colleagues.section.documents")}>
          <ColleagueDocuments colleagueId={colleague.id} />
        </PanelSection>
      </div>
    </div>
  );
}

// ── Documents ──

// Personal-document block: upload control + the shared attachment grid. Lives in
// view mode only (an existing colleague id is required to attach). Delete is
// gated to admins and the uploader, matching the backend.
function ColleagueDocuments({ colleagueId }: { readonly colleagueId: string }) {
  const { t } = useTranslation(["hr", "common"]);
  const [error, setError] = useState<string | null>(null);
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === "admin";

  const { upload, limits, attachmentCount } = useResourceAttachmentUpload({
    resource: "hr/colleagues",
    resourceId: colleagueId,
    onError: err => setError(errorMessage(err, t("common:common.error.uploadFailed"))),
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

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <FileUploadButton multiple disabled={upload.isPending} onSelect={handleUpload}>
          <Button type="button" variant="outline" size="sm" disabled={upload.isPending}>
            <Upload aria-hidden="true" />
            {upload.isPending ? t("attachments.uploading") : t("attachments.upload")}
          </Button>
        </FileUploadButton>
        <AttachFromDriveButton
          resource="hr/colleagues"
          resourceId={colleagueId}
          onError={err => setError(errorMessage(err, t("common:common.error.uploadFailed")))}
        />
      </div>
      <ResourceAttachmentSection
        resource="hr/colleagues"
        resourceId={colleagueId}
        i18nNs="hr"
        canDelete={att => isAdmin || att.uploadedBy === user?.id}
      />
    </div>
  );
}
