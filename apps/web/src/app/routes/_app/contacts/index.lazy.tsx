/* eslint-disable react-refresh/only-export-components */
import type { ContactFormState } from "./-contact-form-logic";
import type { ContactView } from "@/shared/lib/api/contacts";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Edit3, Lock, Plus, Search, Share2, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useContacts, useCreateContact, useDeleteContact, useUpdateContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { ContactFormDialog } from "./-contact-form-dialog";
import { contactFormToInput } from "./-contact-form-logic";
import { ContactShareDialog } from "./-contact-share-dialog";

export const Route = createLazyFileRoute("/_app/contacts/")({
  component: ContactsListPage,
});

const SENSITIVE_FIELDS = ["contactPerson", "phone", "email", "address", "taxId", "note", "status"] as const;
const STATUS_FILTERS = ["all", "active", "inactive"] as const;
const VISIBILITY_FILTERS = ["all", "private", "public"] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type VisibilityFilter = (typeof VISIBILITY_FILTERS)[number];

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

export function ContactsListPage() {
  const { t } = useTranslation(["contacts", "common"]);
  const [tagDraft, setTagDraft] = useState("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContactView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactView | null>(null);
  const [shareTarget, setShareTarget] = useState<ContactView | null>(null);
  const [detailTarget, setDetailTarget] = useState<ContactView | null>(null);

  const contactsQuery = useContacts({ tag: tag || undefined });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const contacts = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);

  const kpis = useMemo(() => ({
    total: contacts.length,
    active: contacts.filter(c => c.status === "active").length,
    inactive: contacts.filter(c => c.status === "inactive").length,
    private: contacts.filter(c => c.visibility === "private").length,
    public: contacts.filter(c => c.visibility === "public").length,
    confidential: contacts.filter(c => c.confidential).length,
  }), [contacts]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter)
        return false;
      if (visibilityFilter !== "all" && c.visibility !== visibilityFilter)
        return false;
      if (needle) {
        const haystack = [c.name, c.contactPerson, c.note]
          .filter((v): v is string => Boolean(v))
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle))
          return false;
      }
      return true;
    });
  }, [contacts, search, statusFilter, visibilityFilter]);

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

  const lockedLabel = t("masked.locked");
  const hiddenLabel = t("masked.hiddenValue");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("page.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          {t("list.create")}
        </Button>
      </div>

      {contactsQuery.error && <ErrorBanner message={errorMessage(contactsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              aria-label={t("list.searchPlaceholder")}
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              value={statusFilter}
              options={STATUS_FILTERS}
              onChange={setStatusFilter}
              label={key => (key === "all" ? t("list.statusAll") : t(`status.${key}` as const))}
              count={key => (key === "all" ? contacts.length : kpis[key])}
            />
            <FilterChips
              value={visibilityFilter}
              options={VISIBILITY_FILTERS}
              onChange={setVisibilityFilter}
              label={key => (key === "all" ? t("list.visibilityAll") : t(`visibility.${key}` as const))}
              count={key => (key === "all" ? contacts.length : kpis[key])}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-dashed border-border/60 pt-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
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
      </div>

      {contactsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : filtered.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="h-9">{t("field.companyUnit")}</TableHead>
                      <TableHead>{t("field.contactPerson")}</TableHead>
                      <TableHead>{t("field.phone")}</TableHead>
                      <TableHead>{t("field.email")}</TableHead>
                      <TableHead>{t("field.tags")}</TableHead>
                      <TableHead>{t("field.status")}</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((contact) => {
                      const locked = isMasked(contact);
                      const status = contact.status ? t(`status.${contact.status}` as const) : null;
                      return (
                        <TableRow key={contact.id} className="text-sm">
                          <TableCell className="max-w-[18rem] py-2">
                            <div className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-semibold text-primary"
                              >
                                {contact.name.slice(0, 1).toUpperCase()}
                              </span>
                              <div className="flex min-w-0 flex-col gap-1">
                                <Button
                                  variant="link"
                                  className="h-auto justify-start truncate p-0 text-sm font-medium text-foreground"
                                  onClick={() => setDetailTarget(contact)}
                                >
                                  {contact.name}
                                </Button>
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge variant={contact.visibility === "public" ? "secondary" : "outline"}>
                                    {t(`visibility.${contact.visibility}` as const)}
                                  </Badge>
                                  {contact.confidential && <Badge variant="outline">{t("field.confidential")}</Badge>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <ContactFieldValue value={contact.contactPerson} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </TableCell>
                          <TableCell className="py-2">
                            <ContactFieldValue value={contact.phone} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </TableCell>
                          <TableCell className="py-2">
                            <ContactFieldValue value={contact.email} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </TableCell>
                          <TableCell className="py-2">
                            {contact.tags.length > 0
                              ? (
                                  <div className="flex flex-wrap gap-1">
                                    {contact.tags.slice(0, 2).map(tg => (
                                      <Badge key={tg.id} variant="outline">{tg.name}</Badge>
                                    ))}
                                    {contact.tags.length > 2 && (
                                      <span className="text-xs text-muted-foreground">{`+${contact.tags.length - 2}`}</span>
                                    )}
                                  </div>
                                )
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="py-2">
                            <ContactFieldValue value={status} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            {contact.canManage && (
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t("actions.share", { name: contact.name })}
                                  onClick={() => setShareTarget(contact)}
                                >
                                  <Share2 data-icon="inline" />
                                </Button>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t("actions.edit", { name: contact.name })}
                                  onClick={() => setEditTarget(contact)}
                                >
                                  <Edit3 data-icon="inline" />
                                </Button>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t("actions.delete", { name: contact.name })}
                                  onClick={() => setDeleteTarget(contact)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 data-icon="inline" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

      <ContactDetailDrawer
        contact={detailTarget}
        onOpenChange={open => !open && setDetailTarget(null)}
        lockedLabel={lockedLabel}
        hiddenLabel={hiddenLabel}
        onEdit={(c) => {
          setDetailTarget(null);
          setEditTarget(c);
        }}
        onShare={(c) => {
          setDetailTarget(null);
          setShareTarget(c);
        }}
        onDelete={(c) => {
          setDetailTarget(null);
          setDeleteTarget(c);
        }}
      />

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

function FilterChips<T extends string>({
  value,
  options,
  onChange,
  label,
  count,
}: {
  readonly value: T;
  readonly options: readonly T[];
  readonly onChange: (value: T) => void;
  readonly label: (key: T) => string;
  readonly count: (key: T) => number;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(option => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={value === option ? "default" : "outline"}
          className="rounded-full"
          aria-label={`${label(option)} ${count(option)}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          <span>{label(option)}</span>
          <span className="tabular-nums text-current/70">{count(option)}</span>
        </Button>
      ))}
    </div>
  );
}

function DrawerField({
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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">
        <ContactFieldValue value={value} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
      </dd>
    </div>
  );
}

function ContactDetailDrawer({
  contact,
  onOpenChange,
  lockedLabel,
  hiddenLabel,
  onEdit,
  onShare,
  onDelete,
}: {
  readonly contact: ContactView | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly lockedLabel: string;
  readonly hiddenLabel: string;
  readonly onEdit: (contact: ContactView) => void;
  readonly onShare: (contact: ContactView) => void;
  readonly onDelete: (contact: ContactView) => void;
}) {
  const { t } = useTranslation(["contacts", "common"]);
  const locked = contact ? isMasked(contact) : false;
  const status = contact?.status ? t(`status.${contact.status}` as const) : null;

  return (
    <Sheet open={!!contact} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[28rem] max-w-[92vw]">
        {contact && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={contact.visibility === "public" ? "secondary" : "outline"}>
                  {t(`visibility.${contact.visibility}` as const)}
                </Badge>
                {contact.confidential && <Badge variant="outline">{t("field.confidential")}</Badge>}
              </div>
              <SheetTitle className="break-words text-lg">{contact.name}</SheetTitle>
              <SheetDescription className="sr-only">{contact.name}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-4">
              <section className="space-y-3">
                <h3 className="text-sm font-medium">{t("drawer.contactMethods")}</h3>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DrawerField label={t("field.contactPerson")} value={contact.contactPerson} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                  <DrawerField label={t("field.phone")} value={contact.phone} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                  <DrawerField label={t("field.email")} value={contact.email} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                  <DrawerField label={t("field.status")} value={status} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                  <DrawerField label={t("field.address")} value={contact.address} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                  <DrawerField label={t("field.taxId")} value={contact.taxId} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                </dl>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium">{t("drawer.tagsAndNotes")}</h3>
                {contact.tags.length > 0
                  ? (
                      <div className="flex flex-wrap gap-1.5">
                        {contact.tags.map(tg => (
                          <Badge key={tg.id} variant="outline">{tg.name}</Badge>
                        ))}
                      </div>
                    )
                  : <p className="text-sm text-muted-foreground">—</p>}
                <DrawerField label={t("field.note")} value={contact.note} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
              </section>
            </div>

            {contact.canManage && (
              <SheetFooter>
                <h3 className="sr-only">{t("drawer.sharing")}</h3>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => onShare(contact)}>
                    <Share2 data-icon="inline-start" />
                    {t("share.title")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => onEdit(contact)}>
                    <Edit3 data-icon="inline-start" />
                    {t("form.editTitle")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(contact)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t("delete.title")}
                  </Button>
                </div>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
