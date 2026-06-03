// Procurement tab: filterable list (status + category) + create dialog. Status
// is display-only here — editing happens in the detail panel. Rows open the
// procurement detail drawer. Mounted only when the caller has procurement.view,
// so it assumes read access; create/pin need canManage. Procurement is
// non-deletable — retire a record via the `cancelled` status instead.

import type { FilterDimension } from "@/shared/components/list-filter";
import type {
  CreateProcurementInput,
  ProcurementPriority,
  ProcurementRow,
  ProcurementStatus,
} from "@/shared/lib/api/procurement";
import type { ProjectMemberView, ProjectTag } from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { ListRowsSkeleton } from "@/shared/components/list-skeleton";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { PinToggle } from "@/shared/components/pin-toggle";
import { PrioritySignal } from "@/shared/components/priority-signal";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { tagFilterDimension, TagInput } from "@/shared/components/tags";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
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
import { PROCUREMENT_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { buildMemberLabelMap } from "./-member-helpers";

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
  const rows = procurementsQuery.data?.data ?? [];
  const meta = procurementsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

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
    return row.currency ? `${row.amount} ${row.currency}` : String(row.amount);
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
          {...(canManage ? { create: { label: t("procurement.createButton"), onClick: () => setCreateOpen(true) } } : {})}
        />
      </div>

      {procurementsQuery.error && <ErrorBanner message={errorMessage(procurementsQuery.error, t("common:common.error.loadFailed"))} />}

      {procurementsQuery.isLoading
        ? <ListRowsSkeleton label={t("procurement.loading")} />
        : rows.length === 0
          ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("procurement.empty")}</p>
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

      {canManage && (
        <CreateProcurementDialog
          projectId={projectId}
          members={members}
          memberLabels={memberLabels}
          suppliers={suppliers}
          categories={categories}
          procurementTags={procurementTags}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
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

interface CreateProcurementDialogProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly suppliers: readonly { readonly id: string; readonly name: string }[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly procurementTags: readonly ProjectTag[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function CreateProcurementDialog({ projectId, members, memberLabels, suppliers, categories, procurementTags, open, onOpenChange }: CreateProcurementDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createProcurement = useCreateProcurement();
  const [itemName, setItemName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProcurementStatus>("requested");
  const [priority, setPriority] = useState<ProcurementPriority>("low");
  const [dueDate, setDueDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [supplierId, setSupplierId] = useState("__none__");
  const [categoryId, setCategoryId] = useState("__none__");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [tags, setTags] = useState<readonly string[]>([]);
  const tagSuggestions = useMemo(() => procurementTags.map(tag => tag.name), [procurementTags]);

  const reset = () => {
    setItemName("");
    setTitle("");
    setDescription("");
    setStatus("requested");
    setPriority("low");
    setDueDate("");
    setQuantity("");
    setAmount("");
    setCurrency("");
    setSupplierId("__none__");
    setCategoryId("__none__");
    setAssigneeMemberId("__none__");
    setTags([]);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!itemName.trim() || createProcurement.isPending)
      return;
    const body: CreateProcurementInput = {
      itemName: itemName.trim(),
      status,
      priority,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(quantity ? { quantity: Number(quantity) } : {}),
      ...(amount ? { amount: Number(amount) } : {}),
      ...(currency.trim() ? { currency: currency.trim() } : {}),
      ...(supplierId !== "__none__" ? { supplierId } : {}),
      ...(categoryId !== "__none__" ? { categoryId } : {}),
      ...(assigneeMemberId !== "__none__" ? { assigneeMemberId } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    createProcurement.mutate({ projectId, ...body }, {
      onSuccess: () => {
        toast.success(t("toast.procurementCreated"));
        reset();
        onOpenChange(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("procurement.createTitle")}</DialogTitle>
            <DialogDescription>{t("procurement.createDescription")}</DialogDescription>
          </DialogHeader>

          {createProcurement.error && <ErrorBanner message={errorMessage(createProcurement.error, t("common:common.error.operationFailed"))} />}

          <div className="space-y-1.5">
            <Label htmlFor="proc-item">{t("procurement.field.itemName")}</Label>
            <Input id="proc-item" autoFocus required value={itemName} onChange={e => setItemName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proc-title">{t("procurement.field.title")}</Label>
            <Input id="proc-title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proc-description">{t("procurement.field.description")}</Label>
            <Textarea
              id="proc-description"
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("procurement.detail.descriptionPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t("procurement.field.status")}</Label>
              <Select value={status} onValueChange={v => v !== null && setStatus(v as ProcurementStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => t(`procurement.status.${v}` as const)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{t(`procurement.status.${s}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("procurement.field.priority")}</Label>
              <Select value={priority} onValueChange={v => v !== null && setPriority(v as ProcurementPriority)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => t(`procurement.priority.${v}` as const)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>{t(`procurement.priority.${p}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-due">{t("procurement.field.dueDate")}</Label>
              <Input id="proc-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proc-qty">{t("procurement.field.quantity")}</Label>
              <Input id="proc-qty" type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-amount">{t("procurement.field.amount")}</Label>
              <Input id="proc-amount" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-currency">{t("procurement.field.currency")}</Label>
              <Input id="proc-currency" value={currency} onChange={e => setCurrency(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("procurement.field.category")}</Label>
              <Select value={categoryId} onValueChange={v => v !== null && setCategoryId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => (v === "__none__" ? t("procurement.none") : categories.find(c => c.id === v)?.name ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("procurement.none")}</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("procurement.field.supplier")}</Label>
              <Select value={supplierId} onValueChange={v => v !== null && setSupplierId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => (v === "__none__" ? t("procurement.none") : suppliers.find(s => s.id === v)?.name ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("procurement.none")}</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("procurement.field.assignee")}</Label>
            <Select value={assigneeMemberId} onValueChange={v => v !== null && setAssigneeMemberId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => (v === "__none__" ? t("procurement.none") : memberLabels.get(v) ?? v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("procurement.none")}</SelectItem>
                {members.map(m => (
                  <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("procurement.field.tags")}</Label>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={createProcurement.isPending || !itemName.trim()}>
              {t("procurement.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
