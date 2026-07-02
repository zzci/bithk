/* eslint-disable react-refresh/only-export-components -- shared panel props type lives beside the leaf components. */
// Shared leaf pieces of the contact panel (view + form modes): the panel props
// contract, section/field primitives, the masked-value renderer, and the
// avatar/logo block. Extracted from -contact-panel.tsx.

import type { ContactFormState } from "./-contact-form-logic";
import type { ContactKind, ContactView } from "@/shared/lib/api/contacts";
import { Building2, Lock, Trash2, Upload, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUploadButton } from "@/shared/components/file";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useRemoveContactAvatar, useSetContactAvatar } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";

export type ContactPanelMode = "create" | "view" | "edit";

export interface ContactPanelProps {
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

export function PanelSection({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function FieldInput({
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

export function ViewField({
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

// Read-only avatar (view mode) when `editable` is false; an upload/replace/remove
// control (edit mode) when true. The upload mutations need a saved contact id, so
// in create mode (no id) the control is disabled with a hint. Holds a local
// preview so a fresh upload/removal shows immediately without re-fetching the
// drawer's contact snapshot.
export function ContactAvatar({
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
