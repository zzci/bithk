/* eslint-disable react-refresh/only-export-components */
import type { ContactFormState } from "./-contact-form-logic";
import type { ContactView } from "@/shared/lib/api/contacts";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Edit3, Lock, Plus, Share2, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { useContacts, useCreateContact, useDeleteContact, useUpdateContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { ContactFormDialog } from "./-contact-form-dialog";
import { contactFormToInput } from "./-contact-form-logic";
import { ContactShareDialog } from "./-contact-share-dialog";

export const Route = createLazyFileRoute("/_app/contacts/")({
  component: ContactsListPage,
});

const SENSITIVE_FIELDS = ["contactPerson", "phone", "email", "address", "taxId", "note", "status"] as const;

function isMasked(contact: ContactView): boolean {
  return contact.visibility === "public"
    && contact.confidential
    && !contact.canManage
    && SENSITIVE_FIELDS.every(key => contact[key] === null);
}

function ContactFieldValue({
  value,
  locked,
  lockedLabel,
}: {
  readonly value: string | null;
  readonly locked: boolean;
  readonly lockedLabel: string;
}) {
  if (value)
    return <span className="break-words text-foreground">{value}</span>;
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" aria-label={lockedLabel}>
        <Lock className="size-3.5" />
        <span aria-hidden="true">—</span>
        <span className="sr-only">{lockedLabel}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

export function ContactsListPage() {
  const { t } = useTranslation(["contacts", "common"]);
  const [tagDraft, setTagDraft] = useState("");
  const [tag, setTag] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContactView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactView | null>(null);
  const [shareTarget, setShareTarget] = useState<ContactView | null>(null);

  const contactsQuery = useContacts({ tag: tag || undefined });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const contacts = contactsQuery.data ?? [];

  const handleCreate = (state: ContactFormState) => {
    createContact.mutate(contactFormToInput(state), {
      onSuccess: () => setCreateOpen(false),
    });
  };

  const handleUpdate = (state: ContactFormState) => {
    if (!editTarget)
      return;
    updateContact.mutate({ id: editTarget.id, ...contactFormToInput(state) }, {
      onSuccess: () => setEditTarget(null),
    });
  };

  const applyTag = () => setTag(tagDraft.trim());
  const clearTag = () => {
    setTag("");
    setTagDraft("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("page.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t("list.create")}
        </Button>
      </div>

      {contactsQuery.error && <ErrorBanner message={errorMessage(contactsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="contacts-tag-filter" className="text-sm font-medium">{t("list.filterByTag")}</label>
          <Input
            id="contacts-tag-filter"
            value={tagDraft}
            onChange={e => setTagDraft(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                applyTag();
            }}
            placeholder={t("list.tagPlaceholder")}
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={clearTag} disabled={!tag && !tagDraft}>
            {t("list.clearFilter")}
          </Button>
          <Button type="button" onClick={applyTag}>
            {t("list.applyFilter")}
          </Button>
        </div>
      </div>

      {tag && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Tag className="size-4" />
          <span>{t("list.activeTag", { tag })}</span>
        </div>
      )}

      {contactsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : contacts.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {contacts.map((contact) => {
                  const locked = isMasked(contact);
                  const status = contact.status ? t(`status.${contact.status}` as const) : null;
                  return (
                    <Card key={contact.id} size="sm">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="break-words">{contact.name}</CardTitle>
                              <Badge variant={contact.visibility === "public" ? "secondary" : "outline"} className="text-xs">
                                {t(`visibility.${contact.visibility}` as const)}
                              </Badge>
                              {contact.confidential && <Badge variant="outline" className="text-xs">{t("field.confidential")}</Badge>}
                            </div>
                            {contact.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {contact.tags.map(tag => (
                                  <Badge key={tag.id} variant="outline" className="text-xs">{tag.name}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          {contact.canManage && (
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("actions.share", { name: contact.name })}
                                onClick={() => setShareTarget(contact)}
                              >
                                <Share2 className="size-4" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("actions.edit", { name: contact.name })}
                                onClick={() => setEditTarget(contact)}
                              >
                                <Edit3 className="size-4" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("actions.delete", { name: contact.name })}
                                onClick={() => setDeleteTarget(contact)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                          <ContactField label={t("field.contactPerson")} value={contact.contactPerson} locked={locked} lockedLabel={t("masked.locked")} />
                          <ContactField label={t("field.phone")} value={contact.phone} locked={locked} lockedLabel={t("masked.locked")} />
                          <ContactField label={t("field.email")} value={contact.email} locked={locked} lockedLabel={t("masked.locked")} />
                          <ContactField label={t("field.status")} value={status} locked={locked} lockedLabel={t("masked.locked")} />
                          <ContactField label={t("field.address")} value={contact.address} locked={locked} lockedLabel={t("masked.locked")} wide />
                          <ContactField label={t("field.taxId")} value={contact.taxId} locked={locked} lockedLabel={t("masked.locked")} />
                          <ContactField label={t("field.note")} value={contact.note} locked={locked} lockedLabel={t("masked.locked")} wide />
                        </dl>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

      <ContactFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        pending={createContact.isPending}
        errorMessage={createContact.error ? errorMessage(createContact.error, t("common:common.error.operationFailed")) : null}
        onSubmit={handleCreate}
      />

      <ContactFormDialog
        open={!!editTarget}
        onOpenChange={open => !open && setEditTarget(null)}
        mode="edit"
        initial={editTarget}
        pending={updateContact.isPending}
        errorMessage={updateContact.error ? errorMessage(updateContact.error, t("common:common.error.operationFailed")) : null}
        onSubmit={handleUpdate}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={t("delete.title")}
        description={t("delete.confirm", { name: deleteTarget?.name ?? "" })}
        pending={deleteContact.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          deleteContact.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
        }}
      />

      <ContactShareDialog
        contact={shareTarget}
        open={!!shareTarget}
        onOpenChange={open => !open && setShareTarget(null)}
      />
    </div>
  );
}

function ContactField({
  label,
  value,
  locked,
  lockedLabel,
  wide = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly locked: boolean;
  readonly lockedLabel: string;
  readonly wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        <ContactFieldValue value={value} locked={locked} lockedLabel={lockedLabel} />
      </dd>
    </div>
  );
}
