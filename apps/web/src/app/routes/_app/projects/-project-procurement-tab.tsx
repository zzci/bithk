// Procurement tab: filterable list (status + category) + create dialog. Status
// is display-only here — editing happens in the detail panel. Rows open the
// procurement detail drawer. Mounted only when the caller has procurement.view,
// so it assumes read access; create/pin need canManage. Procurement is
// non-deletable — retire a record via the `cancelled` status instead.

import type {
  CreateProcurementInput,
  ProcurementPriority,
  ProcurementRow,
  ProcurementStatus,
} from "@/shared/lib/api/procurement";
import type { ProjectMemberView, ProjectTag } from "@/shared/lib/api/projects";
import { useNavigate } from "@tanstack/react-router";
import { Pin, PinOff, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { ProjectTagFilter } from "./-project-tag-filter";
import { ProjectTagsCombobox } from "./-project-tags-combobox";

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
  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev => (prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]));
    setPage(1);
  };

  const procurementsQuery = useProcurements(projectId, {
    q: debouncedSearch || undefined,
    status: statusFilter === "__all__" ? undefined : (statusFilter as ProcurementStatus),
    priority: priorityFilter === "__all__" ? undefined : (priorityFilter as ProcurementPriority),
    categoryId: categoryFilter === "__all__" ? undefined : categoryFilter,
    tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    page,
  });
  const suppliersQuery = useContacts();
  const categoriesQuery = useProcurementCategories(projectId);

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);
  const suppliers = useMemo(
    () => (suppliersQuery.data ?? []).map(contact => ({ id: contact.id, name: contact.name })),
    [suppliersQuery.data],
  );
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const supplierNames = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers]);
  const categoryNames = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const rows = procurementsQuery.data?.data ?? [];
  const meta = procurementsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const openProcurement = (id: string) => {
    void navigate({ to: "/projects/$projectId/procurements/$procurementId", params: { projectId, procurementId: id } });
  };

  const supplierName = (id: string | null) =>
    id ? supplierNames.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;
  const categoryName = (id: string | null) =>
    id ? categoryNames.get(id) ?? id : <span className="text-muted-foreground">{t("procurement.none")}</span>;

  const formatAmount = (row: ProcurementRow) => {
    if (row.amount === null)
      return "—";
    return row.currency ? `${row.amount} ${row.currency}` : String(row.amount);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              if (v === null)
                return;
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue>
                {(v: string) => (v === "__all__" ? t("procurement.allStatuses") : t(`procurement.status.${v}` as const))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("procurement.allStatuses")}</SelectItem>
              {PROCUREMENT_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{t(`procurement.status.${s}` as const)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priorityFilter}
            onValueChange={(v) => {
              if (v === null)
                return;
              setPriorityFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue>
                {(v: string) => (v === "__all__" ? t("procurement.allPriorities") : t(`procurement.priority.${v}` as const))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("procurement.allPriorities")}</SelectItem>
              {PROCUREMENT_PRIORITIES.map(p => (
                <SelectItem key={p} value={p}>{t(`procurement.priority.${p}` as const)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={categoryFilter}
            onValueChange={(v) => {
              if (v === null)
                return;
              setCategoryFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue>
                {(v: string) => (v === "__all__" ? t("procurement.allCategories") : categoryNames.get(v) ?? v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("procurement.allCategories")}</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative max-w-xs flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("procurement.searchPlaceholder")}
              aria-label={t("procurement.searchPlaceholder")}
              className="pl-8"
            />
          </div>
          {canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-4" />
              {t("procurement.create")}
            </Button>
          )}
        </div>
      </div>

      {/* Tag filter bar — responsive multi-select chips. Union semantics:
          selecting tags narrows the list to procurements carrying any selected
          tag. */}
      {procurementTags.length > 0 && (
        <div role="group" aria-label={t("procurement.tagFilter")}>
          <ProjectTagFilter
            multiple
            tags={procurementTags}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
          />
        </div>
      )}

      {procurementsQuery.error && <ErrorBanner message={errorMessage(procurementsQuery.error, t("common:common.error.loadFailed"))} />}

      {procurementsQuery.isLoading
        ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("procurement.loading")}</p>
        : rows.length === 0
          ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("procurement.empty")}</p>
          : (
              <ul>
                {rows.map(row => (
                  <li key={row.id} className="group flex items-center rounded-md transition-colors hover:bg-muted/50">
                    <button
                      type="button"
                      aria-label={row.itemName}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openProcurement(row.id)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.itemName}</span>
                      <Badge variant="secondary" className={cn("shrink-0", PROCUREMENT_STATUS_BADGE[row.status])}>{t(`procurement.status.${row.status}` as const)}</Badge>
                      <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">{formatAmount(row)}</span>
                        <span className="hidden truncate sm:inline">{categoryName(row.categoryId)}</span>
                        <span className="hidden truncate md:inline">{supplierName(row.supplierId)}</span>
                      </div>
                    </button>
                    {canManage && (
                      <div className="shrink-0 pr-1 transition-opacity">
                        <ProcurementPinToggle projectId={projectId} row={row} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
      {totalPages > 1 && meta && (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-muted-foreground">{t("procurement.total", { count: meta.total })}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
          </div>
        </div>
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      aria-pressed={row.pinned}
      aria-label={t(row.pinned ? "overview.unpinAction" : "overview.pinAction")}
      disabled={togglePin.isPending}
      onClick={() => {
        const willPin = !row.pinned;
        togglePin.mutate({ projectId, id: row.id, pin: willPin }, {
          onSuccess: () => toast.success(t(willPin ? "toast.procurementPinned" : "toast.procurementUnpinned")),
          onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
        });
      }}
    >
      {row.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
    </Button>
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
  const [priority, setPriority] = useState<ProcurementPriority>("medium");
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
    setPriority("medium");
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
            <ProjectTagsCombobox
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
