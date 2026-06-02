/* eslint-disable react-refresh/only-export-components */
import type { ContactFormState } from "./-contact-form-logic";
import type { ContactStatus, ContactView, ContactVisibility } from "@/shared/lib/api/contacts";
import { createLazyFileRoute } from "@tanstack/react-router";
import { ChevronDown, Edit3, Lock, Plus, Search, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
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
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { useContactsList, useCreateContact, useDeleteContact, useUpdateContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { ContactFormDialog } from "./-contact-form-dialog";
import { contactFormToInput } from "./-contact-form-logic";
import { ContactShareDialog } from "./-contact-share-dialog";

export const Route = createLazyFileRoute("/_app/contacts/")({
  component: ContactsListPage,
});

const SENSITIVE_FIELDS = ["contactPerson", "phone", "email", "address", "taxId", "note", "status"] as const;

// "show everything" sentinel for the toolbar dropdowns.
const ALL = "__all__";

// Shared grid template so the header row and every data row align on the same
// column tracks. Fixed track widths (not `auto`) guarantee cross-row alignment;
// secondary columns appear progressively at sm/md to keep rows single-line on
// mobile. Columns: name+badges | contactPerson | phone(sm) | email(md) |
// tags(md) | category(md) | status.
const CONTACT_GRID = [
  "grid grid-cols-[minmax(0,1fr)_8rem_5rem] items-center gap-3",
  "sm:grid-cols-[minmax(0,1fr)_8rem_7rem_5rem]",
  "md:grid-cols-[minmax(0,1fr)_8rem_7rem_9rem_8rem_8rem_5rem]",
].join(" ");

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
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [visibilityFilter, setVisibilityFilter] = useState(ALL);
  const [confidentialFilter, setConfidentialFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContactView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactView | null>(null);
  const [shareTarget, setShareTarget] = useState<ContactView | null>(null);
  const [detailTarget, setDetailTarget] = useState<ContactView | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const contactsQuery = useContactsList({
    q: debouncedSearch || undefined,
    status: statusFilter === ALL ? undefined : (statusFilter as ContactStatus),
    visibility: visibilityFilter === ALL ? undefined : (visibilityFilter as ContactVisibility),
    confidential: confidentialFilter === ALL ? undefined : confidentialFilter === "yes",
    tag: tag || undefined,
    page,
  });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const categoriesQuery = useContactCategories();
  const categoryNameById = new Map((categoriesQuery.data ?? []).map(c => [c.id, c.name]));

  const rows = contactsQuery.data?.data ?? [];
  const meta = contactsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

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

  const applyTag = () => {
    setTag(tagDraft.trim());
    setPage(1);
  };
  const clearTag = () => {
    setTag("");
    setTagDraft("");
    setPage(1);
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
      </div>

      {contactsQuery.error && <ErrorBanner message={errorMessage(contactsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <ToolbarFilter
              value={statusFilter}
              allLabel={t("list.statusAll")}
              options={[
                { value: "active", label: t("status.active") },
                { value: "inactive", label: t("status.inactive") },
              ]}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            />
            <ToolbarFilter
              value={visibilityFilter}
              allLabel={t("list.visibilityAll")}
              options={[
                { value: "private", label: t("visibility.private") },
                { value: "public", label: t("visibility.public") },
              ]}
              onChange={(v) => {
                setVisibilityFilter(v);
                setPage(1);
              }}
            />
            <ToolbarFilter
              value={confidentialFilter}
              allLabel={t("list.allConfidential")}
              options={[
                { value: "yes", label: t("list.confidentialYes") },
                { value: "no", label: t("list.confidentialNo") },
              ]}
              onChange={(v) => {
                setConfidentialFilter(v);
                setPage(1);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative max-w-xs flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t("list.searchPlaceholder")}
                aria-label={t("list.searchPlaceholder")}
                className="pl-8"
              />
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              {t("list.create")}
            </Button>
          </div>
        </div>

        {/* Single server-side tag filter — debounced draft applied on demand. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="contacts-tag-filter" className="text-xs font-medium text-muted-foreground">{t("list.filterByTag")}</label>
            <Input
              id="contacts-tag-filter"
              value={tagDraft}
              onChange={e => setTagDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  applyTag();
              }}
              placeholder={t("list.tagPlaceholder")}
              className="max-w-xs"
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
      </div>

      {contactsQuery.isLoading
        ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("list.loading")}</p>
        : rows.length === 0
          ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("list.empty")}</p>
          : (
              <div className="overflow-hidden rounded-lg border">
                {/* Header row — shares CONTACT_GRID so its labels sit over the same
                    column tracks as every data row below. */}
                <div className="flex items-stretch border-b border-border bg-muted/40">
                  <div className={cn(CONTACT_GRID, "min-w-0 flex-1 px-3 py-2 text-xs font-medium text-muted-foreground")}>
                    <span className="truncate">{t("field.companyUnit")}</span>
                    <span className="truncate">{t("field.contactPerson")}</span>
                    <span className="hidden truncate sm:block">{t("field.phone")}</span>
                    <span className="hidden truncate md:block">{t("field.email")}</span>
                    <span className="hidden truncate md:block">{t("field.tags")}</span>
                    <span className="hidden truncate md:block">{t("field.category")}</span>
                    <span className="truncate">{t("field.status")}</span>
                  </div>
                  <div className="w-28 shrink-0">
                    <span className="sr-only">{t("list.colActions")}</span>
                  </div>
                </div>
                <ul>
                  {rows.map((contact) => {
                    const locked = isMasked(contact);
                    const status = contact.status ? t(`status.${contact.status}` as const) : null;
                    return (
                      <li key={contact.id} className="group flex items-stretch border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/50">
                        <button
                          type="button"
                          aria-label={contact.name}
                          className={cn(CONTACT_GRID, "min-w-0 flex-1 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
                          onClick={() => setDetailTarget(contact)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-semibold text-primary"
                            >
                              {contact.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="flex min-w-0 flex-col gap-1">
                              <span className="truncate text-sm font-medium">{contact.name}</span>
                              <span className="flex flex-wrap items-center gap-1">
                                <Badge variant="secondary" className={contact.visibility === "public" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"}>
                                  {t(`visibility.${contact.visibility}` as const)}
                                </Badge>
                                {contact.confidential && <Badge variant="secondary" className="bg-warning/10 text-warning">{t("field.confidential")}</Badge>}
                              </span>
                            </span>
                          </span>
                          <span className="truncate text-xs">
                            <ContactFieldValue value={contact.contactPerson} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </span>
                          <span className="hidden truncate text-xs sm:block">
                            <ContactFieldValue value={contact.phone} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </span>
                          <span className="hidden truncate text-xs md:block">
                            <ContactFieldValue value={contact.email} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </span>
                          <span className="hidden min-w-0 items-center gap-1 md:flex">
                            {contact.tags.length > 0
                              ? (
                                  <>
                                    {contact.tags.slice(0, 2).map(tg => (
                                      <Badge key={tg.id} variant="outline" className="max-w-full truncate">{tg.name}</Badge>
                                    ))}
                                    {contact.tags.length > 2 && (
                                      <span className="text-xs text-muted-foreground">{`+${contact.tags.length - 2}`}</span>
                                    )}
                                  </>
                                )
                              : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span className="hidden truncate text-xs md:block">
                            {contact.categoryId
                              ? (categoryNameById.get(contact.categoryId) ?? contact.categoryId)
                              : <span className="text-muted-foreground">{t("category.none")}</span>}
                          </span>
                          <span className="truncate text-xs">
                            <ContactFieldValue value={status} locked={locked} lockedLabel={lockedLabel} hiddenLabel={hiddenLabel} />
                          </span>
                        </button>
                        <div className="flex w-28 shrink-0 items-center justify-end gap-1 pr-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          {contact.canManage && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label={t("actions.share", { name: contact.name })}
                                onClick={() => setShareTarget(contact)}
                              >
                                <Share2 data-icon="inline" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label={t("actions.edit", { name: contact.name })}
                                onClick={() => setEditTarget(contact)}
                              >
                                <Edit3 data-icon="inline" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 text-destructive hover:text-destructive"
                                aria-label={t("actions.delete", { name: contact.name })}
                                onClick={() => setDeleteTarget(contact)}
                              >
                                <Trash2 data-icon="inline" />
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

      {totalPages > 1 && meta && (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-muted-foreground">{t("list.total", { count: meta.total })}</span>
          <div className="flex gap-1">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
          </div>
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

interface ToolbarFilterProps {
  readonly value: string;
  readonly allLabel: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}

/**
 * Text-label dropdown filter for the contacts toolbar — mirrors the procurement
 * tab's DropdownMenu radio pattern. `__all__` is the "show everything" sentinel.
 */
function ToolbarFilter({ value, allLabel, options, onChange }: ToolbarFilterProps) {
  const current = value === ALL ? allLabel : options.find(o => o.value === value)?.label ?? allLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" className="w-44 justify-between font-normal" />}>
        <span className="truncate">{current}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={v => v !== null && onChange(v)}>
          <DropdownMenuRadioItem value={ALL}>{allLabel}</DropdownMenuRadioItem>
          {options.map(o => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
                <Badge variant="secondary" className={contact.visibility === "public" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"}>
                  {t(`visibility.${contact.visibility}` as const)}
                </Badge>
                {contact.confidential && <Badge variant="secondary" className="bg-warning/10 text-warning">{t("field.confidential")}</Badge>}
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
