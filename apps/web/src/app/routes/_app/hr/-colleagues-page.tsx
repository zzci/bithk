// HR colleagues page: admin/HR-gated list of internal staff members, each
// linked to exactly one unified user (real or virtual). Clicking a row opens
// the shared ResizableDrawer to the colleague detail (profile metadata +
// personal documents); create / view / edit all happen in that one drawer
// panel (see -colleague-panel.tsx). The user picker sources from
// /account/assignable-users so both real and virtual users are selectable.

import type { ColleagueForm } from "./-colleague-form-logic";
import type { HrColleagueRow, HrColleagueStatus, HrEmploymentType } from "@/shared/lib/api/hr";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { ResizableDrawer } from "@/shared/components/resizable-drawer";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useDebounce } from "@/shared/hooks/use-debounce";
import {
  HR_COLLEAGUE_STATUSES,
  HR_EMPLOYMENT_TYPES,
  useArchiveHrColleague,
  useCreateHrColleague,
  useHrColleagueFacets,
  useHrColleagues,
  useUpdateHrColleague,
} from "@/shared/lib/api/hr";
import { useAssignableUsers } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { colleagueFormToProfileInput } from "./-colleague-form-logic";
import { HR_EMPLOYMENT_LABEL_KEY } from "./-colleague-labels";
import { ColleaguePanel } from "./-colleague-panel";

const ALL = "__all__";

type DrawerState
  = | { readonly mode: "create" }
    | { readonly mode: "view"; readonly colleague: HrColleagueRow }
    | { readonly mode: "edit"; readonly colleague: HrColleagueRow };

export function HrColleaguesPage() {
  const { t } = useTranslation(["hr", "common"]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState(ALL);
  const [departmentFilter, setDepartmentFilter] = useState(ALL);
  const [workLocationFilter, setWorkLocationFilter] = useState(ALL);
  const [hireDateFrom, setHireDateFrom] = useState("");
  const [hireDateTo, setHireDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<HrColleagueRow | null>(null);

  const colleaguesQuery = useHrColleagues({
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(statusFilter !== ALL ? { status: statusFilter as HrColleagueStatus } : {}),
    ...(employmentTypeFilter !== ALL ? { employmentType: employmentTypeFilter as HrEmploymentType } : {}),
    ...(departmentFilter !== ALL ? { department: departmentFilter } : {}),
    ...(workLocationFilter !== ALL ? { workLocation: workLocationFilter } : {}),
    ...(hireDateFrom ? { hireDateFrom } : {}),
    ...(hireDateTo ? { hireDateTo } : {}),
    page,
  });
  const facetsQuery = useHrColleagueFacets();
  const facets = facetsQuery.data;
  const createColleague = useCreateHrColleague();
  const updateColleague = useUpdateHrColleague();
  const archiveColleague = useArchiveHrColleague();
  const usersQuery = useAssignableUsers();
  const users = usersQuery.data ?? [];

  const rows = colleaguesQuery.data?.data ?? [];
  const meta = colleaguesQuery.data?.meta;

  const statusLabel = (status: HrColleagueStatus) =>
    status === "active" ? t("colleagues.statusActive") : t("colleagues.statusArchived");

  const handleSubmit = (form: ColleagueForm) => {
    const profile = colleagueFormToProfileInput(form);
    if (drawer?.mode === "edit") {
      updateColleague.mutate(
        { id: drawer.colleague.id, userId: form.userId, status: form.status, ...profile },
        {
          onSuccess: (updated) => {
            toast.success(t("colleagues.toast.updated"));
            setDrawer({ mode: "view", colleague: updated });
          },
          onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
        },
      );
      return;
    }
    createColleague.mutate(
      { userId: form.userId, ...profile },
      {
        onSuccess: () => {
          toast.success(t("colleagues.toast.created"));
          setDrawer(null);
        },
        onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
      },
    );
  };

  const panelPending = drawer?.mode === "edit" ? updateColleague.isPending : createColleague.isPending;
  const panelError = drawer?.mode === "edit"
    ? (updateColleague.error ? errorMessage(updateColleague.error, t("common:common.error.operationFailed")) : null)
    : (createColleague.error ? errorMessage(createColleague.error, t("common:common.error.operationFailed")) : null);

  return (
    <div className="space-y-4">
      {colleaguesQuery.error && (
        <ErrorBanner message={errorMessage(colleaguesQuery.error, t("common.error.loadFailed"))} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("colleagues.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>

        <div className="w-36">
          <Input
            type="date"
            aria-label={t("colleagues.filter.hireDateFrom")}
            value={hireDateFrom}
            onChange={(e) => {
              setHireDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-36">
          <Input
            type="date"
            aria-label={t("colleagues.filter.hireDateTo")}
            value={hireDateTo}
            onChange={(e) => {
              setHireDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("colleagues.field.status"),
              mode: "single",
              defaultValue: ALL,
              value: statusFilter,
              onChange: (value) => {
                setStatusFilter(value ?? ALL);
                setPage(1);
              },
              options: HR_COLLEAGUE_STATUSES.map(status => ({
                value: status,
                label: statusLabel(status),
              })),
            },
            {
              key: "employmentType",
              label: t("colleagues.filter.employmentType"),
              mode: "single",
              defaultValue: ALL,
              value: employmentTypeFilter,
              onChange: (value) => {
                setEmploymentTypeFilter(value ?? ALL);
                setPage(1);
              },
              options: HR_EMPLOYMENT_TYPES.map(type => ({
                value: type,
                label: t(HR_EMPLOYMENT_LABEL_KEY[type]),
              })),
            },
            {
              key: "department",
              label: t("colleagues.filter.department"),
              mode: "single",
              defaultValue: ALL,
              value: departmentFilter,
              onChange: (value) => {
                setDepartmentFilter(value ?? ALL);
                setPage(1);
              },
              options: (facets?.departments ?? []).map(department => ({
                value: department,
                label: department,
              })),
            },
            {
              key: "workLocation",
              label: t("colleagues.filter.workLocation"),
              mode: "single",
              defaultValue: ALL,
              value: workLocationFilter,
              onChange: (value) => {
                setWorkLocationFilter(value ?? ALL);
                setPage(1);
              },
              options: (facets?.workLocations ?? []).map(workLocation => ({
                value: workLocation,
                label: workLocation,
              })),
            },
          ]}
        />

        <span className="text-sm text-muted-foreground">
          {t("colleagues.totalCount", { count: meta?.total ?? 0 })}
        </span>

        <Button className="ml-auto" onClick={() => setDrawer({ mode: "create" })}>
          <Plus className="mr-1 size-4" />
          {t("colleagues.create")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colleagues.col.user")}</TableHead>
              <TableHead>{t("colleagues.col.code")}</TableHead>
              <TableHead>{t("colleagues.col.title")}</TableHead>
              <TableHead>{t("colleagues.col.department")}</TableHead>
              <TableHead>{t("colleagues.col.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={colleaguesQuery.isLoading}>
            {colleaguesQuery.isLoading
              ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                )
              : rows.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        {t("colleagues.noResults")}
                      </TableCell>
                    </TableRow>
                  )
                : rows.map(colleague => (
                    <TableRow
                      key={colleague.id}
                      className="cursor-pointer"
                      onClick={() => setDrawer({ mode: "view", colleague })}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-left outline-none focus-visible:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawer({ mode: "view", colleague });
                          }}
                        >
                          <span className="font-medium">{colleague.user.name}</span>
                          <span className="text-muted-foreground">{`(${colleague.user.username})`}</span>
                          {colleague.user.isVirtual && (
                            <Badge variant="outline" className="text-xs">
                              {t("colleagues.virtualBadge")}
                            </Badge>
                          )}
                        </button>
                      </TableCell>
                      <TableCell>{colleague.code || "—"}</TableCell>
                      <TableCell>{colleague.title || "—"}</TableCell>
                      <TableCell>{colleague.department || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={colleague.status === "active" ? "default" : "secondary"}>
                          {statusLabel(colleague.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            {t("common.prev")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {page}
            {" / "}
            {meta.totalPages}
          </span>
          <Button variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      )}

      {drawer && (
        <ResizableDrawer
          ariaLabel={drawer.mode === "create"
            ? t("colleagues.createTitle")
            : drawer.colleague.user.name}
          resizeLabel={t("common:common.resize")}
          onClose={() => setDrawer(null)}
        >
          <ColleaguePanel
            mode={drawer.mode}
            colleague={drawer.mode === "create" ? null : drawer.colleague}
            users={users}
            pending={panelPending}
            errorMessage={panelError}
            onClose={() => setDrawer(null)}
            onEdit={() => {
              if (drawer.mode === "view")
                setDrawer({ mode: "edit", colleague: drawer.colleague });
            }}
            onArchive={() => {
              if (drawer.mode !== "create") {
                const target = drawer.colleague;
                setDrawer(null);
                setArchiveTarget(target);
              }
            }}
            onSubmit={handleSubmit}
            onCancel={() => {
              if (drawer.mode === "edit")
                setDrawer({ mode: "view", colleague: drawer.colleague });
              else
                setDrawer(null);
            }}
          />
        </ResizableDrawer>
      )}

      <ConfirmDeleteDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setArchiveTarget(null);
        }}
        title={t("colleagues.archiveTitle")}
        description={t("colleagues.archiveConfirm", { name: archiveTarget?.user.name })}
        confirmLabel={t("colleagues.archive")}
        pending={archiveColleague.isPending}
        onConfirm={() => {
          if (archiveTarget) {
            archiveColleague.mutate(archiveTarget.id, {
              onSuccess: () => {
                toast.success(t("colleagues.toast.archived"));
                setArchiveTarget(null);
              },
              onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
            });
          }
        }}
      />
    </div>
  );
}
