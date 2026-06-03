/* eslint-disable react-refresh/only-export-components */
import type { ContactFormState } from "./-contact-form-logic";
import type { ContactStatus, ContactView } from "@/shared/lib/api/contacts";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Edit3, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { ListRowsSkeleton } from "@/shared/components/list-skeleton";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { TagBadgeList } from "@/shared/components/tag-badge-list";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { useContactsList, useContactTags, useCreateContact, useDeleteContact, useUpdateContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { CONTACT_CONFIDENTIAL_BADGE, CONTACT_VISIBILITY_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { contactFormToInput, isMasked } from "./-contact-form-logic";
import { ContactFieldValue, ContactPanel } from "./-contact-panel";
import { ContactShareDialog } from "./-contact-share-dialog";

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

      {/* Single-row toolbar: ListFilter (status + category + tags) on the left,
          bounded search + create on the right. Wraps on narrow viewports. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ListFilter
            dimensions={[
              {
                key: "status",
                label: t("field.status"),
                mode: "single",
                resident: true,
                defaultValue: ALL,
                value: statusFilter,
                onChange: (value) => {
                  setStatusFilter(value ?? ALL);
                  setPage(1);
                },
                options: [
                  { value: "active", label: t("status.active") },
                  { value: "inactive", label: t("status.inactive") },
                ],
              },
              {
                key: "category",
                label: t("field.category"),
                mode: "single",
                defaultValue: ALL,
                value: categoryFilter,
                onChange: (value) => {
                  setCategoryFilter(value ?? ALL);
                  setPage(1);
                },
                options: categories.map(c => ({ value: c.id, label: c.name })),
              },
              {
                key: "tags",
                label: t("field.tags"),
                mode: "multi",
                value: tagIds,
                onChange: (value) => {
                  setTagIds(value);
                  setPage(1);
                },
                options: (tagsQuery.data ?? []).map(tg => ({ value: tg.id, label: tg.name })),
              },
            ]}
          />
        </div>
        <SearchCreateBar
          search={{
            value: search,
            onChange: (v) => {
              setSearch(v);
              setPage(1);
            },
            placeholder: t("list.searchPlaceholder"),
          }}
          create={{ label: t("list.create"), onClick: () => setDrawer({ mode: "create" }) }}
        />
      </div>

      {contactsQuery.isLoading
        ? <ListRowsSkeleton label={t("list.loading")} bordered />
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
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={contact.name}
                          className={cn(CONTACT_GRID, "h-auto min-w-0 flex-1 shrink rounded-none px-3 py-2 text-left font-normal hover:bg-transparent")}
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
                                <Badge variant="secondary" className={CONTACT_VISIBILITY_BADGE[contact.visibility]}>
                                  {t(`visibility.${contact.visibility}` as const)}
                                </Badge>
                                {contact.confidential && <Badge variant="secondary" className={CONTACT_CONFIDENTIAL_BADGE}>{t("field.confidential")}</Badge>}
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
                                  <TagBadgeList
                                    tags={contact.tags}
                                    max={2}
                                    badgeVariant="outline"
                                    badgeClassName="max-w-full truncate"
                                    moreClassName="text-xs text-muted-foreground"
                                  />
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
                        </Button>
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
        <PaginationFooter
          page={page}
          totalPages={totalPages}
          totalLabel={t("list.total", { count: meta.total })}
          onPrev={() => setPage(p => p - 1)}
          onNext={() => setPage(p => p + 1)}
        />
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
          deleteContact.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
            onError: err => toast.error(errorMessage(err, t("common:common.error.deleteFailed"))),
          });
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
