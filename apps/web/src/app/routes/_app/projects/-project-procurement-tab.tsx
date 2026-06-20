// Procurement tab: filterable list (status + category) + create dialog. Status
// is display-only here — editing happens in the detail panel. Rows open the
// procurement detail drawer. Mounted only when the caller has procurement.view,
// so it assumes read access; create/pin need canManage. Procurement is
// non-deletable — retire a record via the `cancelled` status instead.

import type { ProcurementFormValues } from "./-project-procurement-form-logic";
import type { FilterDimension } from "@/shared/components/list-filter";
import type {
  CreateProcurementInput,
  ProcurementPriority,
  ProcurementRow,
  ProcurementStatus,
} from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { ListRowsSkeleton } from "@/shared/components/list-skeleton";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { PinToggle } from "@/shared/components/pin-toggle";
import { PrioritySignal } from "@/shared/components/priority-signal";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { tagFilterDimension } from "@/shared/components/tags";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useContacts } from "@/shared/lib/api/contacts";
import { useToggleProcurementPin } from "@/shared/lib/api/pins";
import {
  PROCUREMENT_PRIORITIES,
  PROCUREMENT_STATUSES,
  useCreateProcurement,
  useProcurements,
  useProcurementTags,
} from "@/shared/lib/api/procurement";
import { useProcurementCategories } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatMoney } from "@/shared/lib/format";
import { PROCUREMENT_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { buildMemberLabelMap } from "./-member-helpers";
import { ProcurementForm } from "./-project-procurement-form";
import {
  EMPTY_PROCUREMENT_FORM,
  PROCUREMENT_FORM_NONE,
} from "./-project-procurement-form-logic";

// Shared grid template so the header row and every data row align on the same
// column tracks. Fixed track widths (not `auto`) guarantee cross-row alignment;
// secondary columns appear progressively at sm/md to keep rows single-line on
// mobile. Columns: id | itemName+title | status | amount(right) |
// category | supplier | priority(last).
const PROCUREMENT_GRID = [
  "grid grid-cols-[4.5rem_minmax(0,1fr)_6rem_6.5rem_auto] items-center gap-3",
  "sm:grid-cols-[4.5rem_minmax(0,1fr)_6rem_6.5rem_8rem_auto]",
  "md:grid-cols-[4.5rem_minmax(0,1fr)_6rem_6.5rem_8rem_9rem_auto]",
].join(" ");

interface ProjectProcurementTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  readonly canManage: boolean;
}

export function ProjectProcurementTab({ projectId, members, userNames, canManage }: ProjectProcurementTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [priorityFilter, setPriorityFilter] = useState("__all__");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  // Selected tag ids; empty means no tag filter. A procurement matches the union
  // of the selected tags.
  const [selectedTagIds, setSelectedTagIds] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const procurementTagsQuery = useProcurementTags();
  const procurementTags = useMemo(() => procurementTagsQuery.data ?? [], [procurementTagsQuery.data]);

  const categoriesQuery = useProcurementCategories(projectId);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  // If the selected category is deleted (e.g. in settings) its id drops out of
  // the loaded options. Fall back to "__all__" so the toolbar label and the
  // applied filter cannot diverge — otherwise the trigger shows "All categories"
  // while the query still filters by the ghost id, returning a confusing empty
  // list. Derived (not an effect) so the stale id never reaches the query.
  const effectiveCategory = categoryFilter !== "__all__" && categoriesQuery.isSuccess && !categories.some(c => c.id === categoryFilter)
    ? "__all__"
    : categoryFilter;

  const procurementsQuery = useProcurements(projectId, {
    q: debouncedSearch || undefined,
    status: statusFilter === "__all__" ? undefined : (statusFilter as ProcurementStatus),
    priority: priorityFilter === "__all__" ? undefined : (priorityFilter as ProcurementPriority),
    categoryId: effectiveCategory === "__all__" ? undefined : effectiveCategory,
    tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    page,
  });
  const suppliersQuery = useContacts();

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const suppliers = useMemo(
    () => (suppliersQuery.data ?? []).map(contact => ({ id: contact.id, name: contact.name })),
    [suppliersQuery.data],
  );
  const supplierNames = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers]);
  const categoryNames = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const tagSuggestions = useMemo(() => procurementTags.map(tag => tag.name), [procurementTags]);
  const rows = procurementsQuery.data?.data ?? [];
  const meta = procurementsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const createProcurement = useCreateProcurement();

  // Create runs through the same drawer form as edit (mode="create"), mapping
  // the form values to the create payload (sentinel/empty fields are dropped).
  const handleCreate = (values: ProcurementFormValues) => {
    if (!values.itemName.trim() || createProcurement.isPending)
      return;
    const body: CreateProcurementInput = {
      itemName: values.itemName.trim(),
      status: values.status,
      priority: values.priority,
      ...(values.title.trim() ? { title: values.title.trim() } : {}),
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
      ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      ...(values.quantity.trim() ? { quantity: Number(values.quantity) } : {}),
      ...(values.amount !== null ? { amount: values.amount } : {}),
      ...(values.currency.trim() ? { currency: values.currency.trim() } : {}),
      ...(values.supplierId !== PROCUREMENT_FORM_NONE ? { supplierId: values.supplierId } : {}),
      ...(values.categoryId !== PROCUREMENT_FORM_NONE ? { categoryId: values.categoryId } : {}),
      ...(values.assigneeMemberId !== PROCUREMENT_FORM_NONE ? { assigneeMemberId: values.assigneeMemberId } : {}),
      ...(values.tags.length > 0 ? { tags: values.tags } : {}),
    };
    createProcurement.mutate({ projectId, ...body }, {
      onSuccess: () => {
        toast.success(t("toast.procurementCreated"));
        setCreateOpen(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const openProcurement = useCallback((id: string) => {
    void navigate({ to: "/projects/$projectId/procurements/$procurementId", params: { projectId, procurementId: id } });
  }, [navigate, projectId]);

  const supplierName = (id: string | null) =>
    id ? supplierNames.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;
  const categoryName = (id: string | null) =>
    id ? categoryNames.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;

  const formatAmount = (row: ProcurementRow) => {
    if (row.amount === null)
      return "—";
    return row.currency ? `${formatMoney(row.amount)} ${row.currency}` : formatMoney(row.amount);
  };

  // Filter dimensions: status / priority / category single-selects, plus a tags
  // multi-select (union semantics) whose selected values surface as removable
  // chips in the shared Drive-style ListFilter. The tag dimension hides itself
  // when there is no tag vocabulary (consistent hide-when-empty).
  const tagDim = tagFilterDimension({
    tags: procurementTags,
    value: selectedTagIds,
    onChange: (value) => {
      setSelectedTagIds(value);
      setPage(1);
    },
    label: t("field.tags"),
  });
  const dimensions: FilterDimension[] = [
    {
      key: "status",
      label: t("procurement.allStatuses"),
      mode: "single",
      value: statusFilter === "__all__" ? null : statusFilter,
      onChange: (value) => {
        setStatusFilter(value ?? "__all__");
        setPage(1);
      },
      options: PROCUREMENT_STATUSES.map(s => ({ value: s, label: t(`procurement.status.${s}` as const) })),
    },
    {
      key: "priority",
      label: t("procurement.allPriorities"),
      mode: "single",
      value: priorityFilter === "__all__" ? null : priorityFilter,
      onChange: (value) => {
        setPriorityFilter(value ?? "__all__");
        setPage(1);
      },
      options: PROCUREMENT_PRIORITIES.map(p => ({ value: p, label: t(`procurement.priority.${p}` as const) })),
    },
    {
      key: "category",
      label: t("procurement.allCategories"),
      mode: "single",
      value: effectiveCategory === "__all__" ? null : effectiveCategory,
      onChange: (value) => {
        setCategoryFilter(value ?? "__all__");
        setPage(1);
      },
      options: categories.map(c => ({ value: c.id, label: c.name })),
    },
    ...(tagDim ? [tagDim] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ListFilter dimensions={dimensions} />
        </div>
        <SearchCreateBar
          search={{
            value: search,
            onChange: (v) => {
              setSearch(v);
              setPage(1);
            },
            placeholder: t("procurement.searchPlaceholder"),
          }}
          {...(canManage
            ? { create: { label: t("procurement.create"), onClick: () => {
                createProcurement.reset();
                setCreateOpen(true);
              } } }
            : {})}
        />
      </div>

      {procurementsQuery.error && <ErrorBanner message={errorMessage(procurementsQuery.error, t("common:common.error.loadFailed"))} />}

      {procurementsQuery.isLoading
        ? <ListRowsSkeleton label={t("procurement.loading")} />
        : rows.length === 0
          ? <EmptyHint className="px-3">{t("procurement.empty")}</EmptyHint>
          : (
              <div className="overflow-hidden">
                {/* Header row — shares PROCUREMENT_GRID so its labels sit over the
                    same column tracks as every data row below. */}
                <div className="flex items-stretch border-b border-border bg-muted/40">
                  <div className={cn(PROCUREMENT_GRID, "min-w-0 flex-1 px-3 py-2 text-xs font-medium text-muted-foreground")}>
                    <span className="truncate">{t("procurement.col.id")}</span>
                    <span className="truncate">{t("procurement.col.itemName")}</span>
                    <span className="truncate">{t("procurement.col.status")}</span>
                    <span className="truncate text-right">{t("procurement.col.amount")}</span>
                    <span className="hidden truncate sm:block">{t("procurement.col.category")}</span>
                    <span className="hidden truncate md:block">{t("procurement.col.supplier")}</span>
                    <span><span className="sr-only">{t("procurement.col.priority")}</span></span>
                  </div>
                  {canManage && <div className="w-9 shrink-0" aria-hidden="true" />}
                </div>
                <ul>
                  {rows.map(row => (
                    <li key={row.id} className="group flex items-stretch border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/50">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={row.itemName}
                        className={cn(PROCUREMENT_GRID, "h-auto min-w-0 flex-1 shrink rounded-none px-3 py-2 text-left font-normal hover:bg-transparent")}
                        onClick={() => openProcurement(row.id)}
                      >
                        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">{row.id}</span>
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">{row.itemName}</span>
                          {row.title && <span className="min-w-0 truncate text-xs text-muted-foreground">{row.title}</span>}
                        </span>
                        <Badge variant="secondary" className={cn("w-fit max-w-full truncate", PROCUREMENT_STATUS_BADGE[row.status])}>{t(`procurement.status.${row.status}` as const)}</Badge>
                        <span className="truncate text-right text-xs tabular-nums text-muted-foreground">{formatAmount(row)}</span>
                        <span className="hidden truncate text-xs text-muted-foreground sm:block">{categoryName(row.categoryId)}</span>
                        <span className="hidden truncate text-xs text-muted-foreground md:block">{supplierName(row.supplierId)}</span>
                        <PrioritySignal priority={row.priority} label={t(`procurement.priority.${row.priority}` as const)} />
                      </Button>
                      {canManage && (
                        <div className={cn("flex w-9 shrink-0 items-center justify-center transition-opacity", row.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
                          <ProcurementPinToggle projectId={projectId} row={row} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
      {totalPages > 1 && meta && (
        <PaginationFooter
          page={page}
          totalPages={totalPages}
          totalLabel={t("procurement.total", { count: meta.total })}
          onPrev={() => setPage(p => p - 1)}
          onNext={() => setPage(p => p + 1)}
        />
      )}

      {canManage && createOpen && (
        <ResizableDrawer
          ariaLabel={t("procurement.createTitle")}
          resizeLabel={t("common:common.resize")}
          onClose={() => setCreateOpen(false)}
        >
          <ProcurementForm
            mode="create"
            initial={EMPTY_PROCUREMENT_FORM}
            members={members}
            memberLabels={memberLabels}
            suppliers={suppliers}
            categories={categories}
            tagSuggestions={tagSuggestions}
            pending={createProcurement.isPending}
            error={createProcurement.error ? errorMessage(createProcurement.error, t("common:common.error.operationFailed")) : null}
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </ResizableDrawer>
      )}
    </div>
  );
}

interface ProcurementPinToggleProps {
  readonly projectId: string;
  readonly row: ProcurementRow;
}

/** Ghost icon toggle that pins/unpins a procurement, with success/error toasts. */
function ProcurementPinToggle({ projectId, row }: ProcurementPinToggleProps) {
  const { t } = useTranslation(["projects", "common"]);
  const togglePin = useToggleProcurementPin();
  return (
    <PinToggle
      pinned={row.pinned}
      pending={togglePin.isPending}
      className="size-8"
      onToggle={(willPin) => {
        togglePin.mutate({ projectId, id: row.id, pin: willPin }, {
          onSuccess: () => toast.success(t(willPin ? "toast.procurementPinned" : "toast.procurementUnpinned")),
          onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
        });
      }}
    />
  );
}
