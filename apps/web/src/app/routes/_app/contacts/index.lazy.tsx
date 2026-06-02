/* eslint-disable react-refresh/only-export-components */
import type { ContactFormState } from "./-contact-form-logic";
import type { ContactStatus, ContactView } from "@/shared/lib/api/contacts";
import { createLazyFileRoute } from "@tanstack/react-router";
import { ChevronDown, Edit3, Plus, Search, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
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
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { useContactsList, useContactTags, useCreateContact, useDeleteContact, useUpdateContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { contactFormToInput, isMasked } from "./-contact-form-logic";
import { ContactFieldValue, ContactPanel } from "./-contact-panel";
import { ContactShareDialog } from "./-contact-share-dialog";
import { ContactTagFilter } from "./-contact-tag-filter";

export const Route = createLazyFileRoute("/_app/contacts/")({
  component: ContactsListPage,
});

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

type DrawerState
  = | { readonly mode: "create" }
    | { readonly mode: "view"; readonly contact: ContactView }
    | { readonly mode: "edit"; readonly contact: ContactView };

export function ContactsListPage() {
  const { t } = useTranslation(["contacts", "common"]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [tagIds, setTagIds] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactView | null>(null);
  const [shareTarget, setShareTarget] = useState<ContactView | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const contactsQuery = useContactsList({
    q: debouncedSearch || undefined,
    status: statusFilter === ALL ? undefined : (statusFilter as ContactStatus),
    categoryId: categoryFilter === ALL ? undefined : categoryFilter,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    page,
  });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const categoriesQuery = useContactCategories();
  const tagsQuery = useContactTags();
  const categories = categoriesQuery.data ?? [];
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));

  const rows = contactsQuery.data?.data ?? [];
  const meta = contactsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const toggleTag = (tagId: string) => {
    setTagIds(prev => (prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]));
    setPage(1);
  };

  const handleSubmit = (state: ContactFormState) => {
    if (drawer?.mode === "edit") {
      updateContact.mutate({ id: drawer.contact.id, ...contactFormToInput(state) }, {
        onSuccess: () => setDrawer(null),
      });
      return;
    }
    createContact.mutate(contactFormToInput(state), {
      onSuccess: () => setDrawer(null),
    });
  };

  const panelPending = drawer?.mode === "edit" ? updateContact.isPending : createContact.isPending;
  const panelError = drawer?.mode === "edit"
    ? (updateContact.error ? errorMessage(updateContact.error, t("common:common.error.operationFailed")) : null)
    : (createContact.error ? errorMessage(createContact.error, t("common:common.error.operationFailed")) : null);

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

      {/* Single-row toolbar: status + category + tag dropdowns, then search and
          create pushed to the trailing edge. Wraps on narrow viewports. */}
      <div className="flex flex-wrap items-center gap-2">
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
          value={categoryFilter}
          allLabel={t("list.categoryAll")}
          options={categories.map(c => ({ value: c.id, label: c.name }))}
          onChange={(v) => {
            setCategoryFilter(v);
            setPage(1);
          }}
        />
        <ContactTagFilter tags={tagsQuery.data ?? []} selectedTagIds={tagIds} onToggle={toggleTag} />
        <div className="relative ml-auto max-w-xs flex-1">
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
        <Button onClick={() => setDrawer({ mode: "create" })}>
          <Plus aria-hidden="true" />
          {t("list.create")}
        </Button>
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
                          onClick={() => setDrawer({ mode: "view", contact })}
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
                                onClick={() => setDrawer({ mode: "edit", contact })}
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

      {drawer && (
        <ResizableDrawer
          ariaLabel={drawerAriaLabel(drawer, t)}
          resizeLabel={t("drawer.resize")}
          onClose={() => setDrawer(null)}
        >
          <ContactPanel
            mode={drawer.mode}
            contact={drawer.mode === "create" ? null : drawer.contact}
            pending={panelPending}
            errorMessage={panelError}
            lockedLabel={lockedLabel}
            hiddenLabel={hiddenLabel}
            onClose={() => setDrawer(null)}
            onEdit={() => {
              if (drawer.mode === "view")
                setDrawer({ mode: "edit", contact: drawer.contact });
            }}
            onShare={() => {
              if (drawer.mode !== "create") {
                const target = drawer.contact;
                setDrawer(null);
                setShareTarget(target);
              }
            }}
            onDelete={() => {
              if (drawer.mode !== "create") {
                const target = drawer.contact;
                setDrawer(null);
                setDeleteTarget(target);
              }
            }}
            onSubmit={handleSubmit}
          />
        </ResizableDrawer>
      )}

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

function drawerAriaLabel(drawer: DrawerState, t: (key: string) => string): string {
  if (drawer.mode === "create")
    return t("form.createTitle");
  if (drawer.mode === "edit")
    return t("form.editTitle");
  return drawer.contact.name;
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
