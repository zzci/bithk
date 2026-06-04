/* eslint-disable react-refresh/only-export-components */
import type { ContactFormState } from "./-contact-form-logic";
import type { ContactKind, ContactStatus, ContactView } from "@/shared/lib/api/contacts";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Building2, Edit3, Share2, Trash2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { ListRowsSkeleton } from "@/shared/components/list-skeleton";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { tagFilterDimension } from "@/shared/components/tags";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useContactCategories } from "@/shared/lib/api/contact-categories";
import { useContact, useContactsList, useContactTags, useCreateContact, useDeleteContact, useUpdateContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";
import { CONTACT_CONFIDENTIAL_BADGE, CONTACT_VISIBILITY_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { contactFormToInput } from "./-contact-form-logic";
import { ContactPanel } from "./-contact-panel";
import { ContactShareDialog } from "./-contact-share-dialog";

export const Route = createLazyFileRoute("/_app/contacts/")({
  component: ContactsListPage,
});

// "show everything" sentinel for the toolbar dropdowns.
const ALL = "__all__";

// Shared grid template so the header row and every data row align on the same
// column tracks. Fixed track widths (not `auto`) guarantee cross-row alignment;
// secondary columns appear progressively at sm/md to keep rows single-line on
// mobile. Person-primary: column 1 is the avatar + name. The trailing fixed
// track holds the visibility + confidential badges so they never widen the name
// cell and rows stay aligned.
// Columns: name | organization(sm) | category(md) | visibility+confidential badges.
const CONTACT_GRID = [
  "grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3",
  "sm:grid-cols-[minmax(0,1fr)_9rem_9rem]",
  "md:grid-cols-[minmax(0,1fr)_9rem_8rem_9rem]",
].join(" ");

type DrawerState
  = | { readonly mode: "create" }
    | { readonly mode: "view"; readonly contact: ContactView }
    | { readonly mode: "edit"; readonly contact: ContactView };

export function ContactsListPage() {
  const { t } = useTranslation(["contacts", "common"]);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [tagIds, setTagIds] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactView | null>(null);
  const [shareTarget, setShareTarget] = useState<ContactView | null>(null);
  // Pending "open the linked organization" request: fetch it, then swap the
  // drawer to view it once resolved.
  const [orgToOpen, setOrgToOpen] = useState<string | null>(null);
  const orgQuery = useContact(orgToOpen ?? undefined);
  const debouncedSearch = useDebounce(search, 300);

  const contactsQuery = useContactsList({
    q: debouncedSearch || undefined,
    kind: kindFilter === ALL ? undefined : (kindFilter as ContactKind),
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

  // Once the requested organization resolves, swap the drawer to view it.
  /* eslint-disable react/set-state-in-effect -- swap the drawer only when the fetched org matches the pending request. */
  useEffect(() => {
    if (orgToOpen && orgQuery.data && orgQuery.data.id === orgToOpen) {
      setDrawer({ mode: "view", contact: orgQuery.data });
      setOrgToOpen(null);
    }
  }, [orgToOpen, orgQuery.data]);
  /* eslint-enable react/set-state-in-effect */

  const handleSubmit = (state: ContactFormState) => {
    if (drawer?.mode === "edit") {
      updateContact.mutate({ id: drawer.contact.id, ...contactFormToInput(state) }, {
        onSuccess: (updated) => {
          toast.success(t("toast.updated"));
          setDrawer({ mode: "view", contact: updated });
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      });
      return;
    }
    createContact.mutate(contactFormToInput(state), {
      onSuccess: () => {
        toast.success(t("toast.created"));
        setDrawer(null);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const panelPending = drawer?.mode === "edit" ? updateContact.isPending : createContact.isPending;
  const panelError = drawer?.mode === "edit"
    ? (updateContact.error ? errorMessage(updateContact.error, t("common:common.error.operationFailed")) : null)
    : (createContact.error ? errorMessage(createContact.error, t("common:common.error.operationFailed")) : null);

  const lockedLabel = t("masked.locked");
  const hiddenLabel = t("masked.hiddenValue");

  const tagDim = tagFilterDimension({
    tags: tagsQuery.data ?? [],
    value: tagIds,
    onChange: (value) => {
      setTagIds(value);
      setPage(1);
    },
    label: t("field.tags"),
  });

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
                key: "kind",
                label: t("field.kind"),
                mode: "single",
                defaultValue: ALL,
                value: kindFilter,
                onChange: (value) => {
                  setKindFilter(value ?? ALL);
                  setPage(1);
                },
                options: [
                  { value: "individual", label: t("kind.individual") },
                  { value: "organization", label: t("kind.organization") },
                ],
              },
              {
                key: "status",
                label: t("field.status"),
                mode: "single",
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
              ...(tagDim ? [tagDim] : []),
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
              <div className="overflow-hidden">
                {/* Header row — shares CONTACT_GRID so its labels sit over the same
                    column tracks as every data row below. */}
                <div className="flex items-stretch border-b border-border bg-muted/40">
                  <div className={cn(CONTACT_GRID, "min-w-0 flex-1 px-3 py-2 text-xs font-medium text-muted-foreground")}>
                    <span className="truncate">{t("field.name")}</span>
                    <span className="hidden truncate sm:block">{t("field.organization")}</span>
                    <span className="hidden truncate md:block">{t("field.category")}</span>
                    <span className="truncate">{t("field.visibility")}</span>
                  </div>
                  <div className="w-28 shrink-0">
                    <span className="sr-only">{t("list.colActions")}</span>
                  </div>
                </div>
                <ul>
                  {rows.map((contact) => {
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
                            {contact.kind === "organization"
                              ? <Building2 role="img" aria-label={t("kind.organization")} className="size-4 shrink-0 text-muted-foreground" />
                              : <User role="img" aria-label={t("kind.individual")} className="size-4 shrink-0 text-muted-foreground" />}
                            <Avatar size="sm" className="size-7">
                              {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt="" /> : null}
                              <AvatarFallback>
                                {contact.name.trim()
                                  ? contact.name.trim().slice(0, 1).toUpperCase()
                                  : contact.kind === "organization"
                                    ? <Building2 className="size-3.5" aria-hidden="true" />
                                    : <User className="size-3.5" aria-hidden="true" />}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm font-medium">{contact.name}</span>
                          </span>
                          <span className="hidden truncate text-xs sm:block">
                            {contact.kind === "individual" && contact.organizationName
                              ? contact.organizationName
                              : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span className="hidden truncate text-xs md:block">
                            {contact.categoryId
                              ? (categoryNameById.get(contact.categoryId) ?? contact.categoryId)
                              : <span className="text-muted-foreground">{t("category.none")}</span>}
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-1">
                            <Badge variant="secondary" className={cn("shrink-0", CONTACT_VISIBILITY_BADGE[contact.visibility])}>
                              {t(`visibility.${contact.visibility}` as const)}
                            </Badge>
                            {contact.confidential && (
                              <Badge variant="secondary" className={cn("shrink-0", CONTACT_CONFIDENTIAL_BADGE)}>{t("field.confidential")}</Badge>
                            )}
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
            onRename={(name) => {
              if (drawer.mode !== "create") {
                updateContact.mutate({ id: drawer.contact.id, name }, {
                  onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
                });
              }
            }}
            onSubmit={handleSubmit}
            onCancel={() => {
              if (drawer.mode === "edit")
                setDrawer({ mode: "view", contact: drawer.contact });
              else
                setDrawer(null);
            }}
            onOpenOrganization={orgId => setOrgToOpen(orgId)}
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
