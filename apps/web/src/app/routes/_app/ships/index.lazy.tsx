/* eslint-disable react-refresh/only-export-components */
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipStatus, ShipView } from "@/shared/lib/api/ships";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, Loader2, MapPin, Ship as ShipIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/shared/components/cover-image";
import { ListFilter } from "@/shared/components/list-filter";
import { CardGridSkeleton } from "@/shared/components/list-skeleton";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { TagBadgeList } from "@/shared/components/tag-badge-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { SHIP_STATUSES, useCreateShip, useShipCount, useShips, useShipTags } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToCreate } from "./-ship-form-logic";
import { ShipStatusBadge } from "./-ship-visuals";

export const Route = createLazyFileRoute("/_app/ships/")({
  component: ShipsListPage,
});

const CURRENT_YEAR = new Date().getUTCFullYear();

export function ShipsListPage() {
  const { t } = useTranslation(["ships", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [status, setStatus] = useState<ShipStatus>("active");
  const [tagId, setTagId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Server-side search reaches the whole fleet (name/code), so every match is
  // reachable through pagination instead of only the currently loaded page.
  const debouncedSearch = useDebounce(search, 300);

  // A new search resets to the first page so results start from the top.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const shipsQuery = useShips({
    status,
    tagId: tagId ?? undefined,
    page,
    q: debouncedSearch,
  });
  const createShip = useCreateShip();
  const shipTags = useShipTags().data ?? [];

  // Fleet KPIs from a dedicated status-keyed count query, stable across the
  // main list's pagination and search.
  const activeCount = useShipCount("active").data;
  const archivedCount = useShipCount("archived").data;
  const ships = useMemo(() => shipsQuery.data?.data ?? [], [shipsQuery.data]);
  const meta = shipsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;
  const isRefetching = shipsQuery.isFetching && !shipsQuery.isLoading;
  const isSearching = debouncedSearch.trim().length > 0;

  const handleCreate = (state: ShipFormState) => {
    createShip.mutate(shipFormToCreate(state), {
      onSuccess: (ship) => {
        setCreateOpen(false);
        void navigate({ to: "/ships/$shipId", params: { shipId: ship.id } });
      },
    });
  };

  const statusCounts: Record<string, number | undefined> = {
    active: activeCount,
    archived: archivedCount,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {t("page.title")}
            {isRefetching && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("list.loading")} />
            )}
          </h1>
          <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
        </div>
      </div>

      {shipsQuery.error && <ErrorBanner message={errorMessage(shipsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("field.status"),
              mode: "single",
              resident: true,
              defaultValue: "active",
              value: status,
              onChange: (value) => {
                setStatus((value ?? "active") as ShipStatus);
                setPage(1);
              },
              options: SHIP_STATUSES.map(s => ({
                value: s,
                label: t(`status.${s}` as const),
                count: statusCounts[s],
              })),
            },
            {
              key: "tags",
              label: t("field.tags"),
              mode: "single",
              residentCount: 5,
              value: tagId,
              onChange: (value) => {
                setTagId(value);
                setPage(1);
              },
              options: shipTags.map(tag => ({ value: tag.id, label: tag.name })),
            },
          ]}
        />
        <SearchCreateBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("list.searchPlaceholder"),
          }}
          {...(isAdmin ? { create: { label: t("list.create"), onClick: () => setCreateOpen(true) } } : {})}
        />
      </div>

      {shipsQuery.isLoading
        ? <CardGridSkeleton label={t("list.loading")} />
        : ships.length === 0
          ? <p className="text-sm text-muted-foreground">{isSearching ? t("list.noMatches") : t("list.empty")}</p>
          : (
              <div
                className={`grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4${isRefetching ? " opacity-60" : ""}`}
                aria-busy={isRefetching}
              >
                {ships.map(ship => (
                  <ShipCard
                    key={ship.id}
                    ship={ship}
                    onOpen={() => void navigate({ to: "/ships/$shipId", params: { shipId: ship.id } })}
                  />
                ))}
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

      <ShipFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        pending={createShip.isPending}
        errorMessage={createShip.error ? errorMessage(createShip.error, t("common:common.error.operationFailed")) : null}
        onSubmit={handleCreate}
      />
    </div>
  );
}

function ShipCard({ ship, onOpen }: { readonly ship: ShipView; readonly onOpen: () => void }) {
  const { t } = useTranslation("ships");

  const specs = [
    { label: t("field.imoNumber"), value: ship.imoNumber },
    { label: t("field.lengthOverall"), value: ship.lengthOverall === null ? null : String(ship.lengthOverall) },
    { label: t("field.grossTonnage"), value: ship.grossTonnage === null ? null : String(ship.grossTonnage) },
    { label: t("field.buildYear"), value: ship.buildYear === null ? null : String(ship.buildYear) },
  ];

  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      aria-label={ship.name}
      className="cursor-pointer transition-all hover:shadow-md hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CoverImage src={ship.coverImageUrl} kind="ship" className="h-28 w-full" />
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate">{ship.name}</CardTitle>
            <p className="font-mono text-xs text-muted-foreground">{ship.code}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ShipStatusBadge status={ship.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y py-2">
          {specs.map(spec => (
            <div key={spec.label} className="min-w-0">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">{spec.label}</dt>
              <dd className="truncate font-mono text-xs">
                {spec.value ?? <span className="text-muted-foreground">{t("overview.notSet")}</span>}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
            <ShipIcon className="size-3" />
            {ship.flagState ?? t("overview.notSet")}
          </span>
          {ship.registryPort && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              {ship.registryPort}
            </span>
          )}
          {ship.buildYear && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              <Calendar className="size-3" />
              {t("list.card.ageValue", { count: Math.max(0, CURRENT_YEAR - ship.buildYear) })}
            </span>
          )}
        </div>

        {ship.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <TagBadgeList
              tags={ship.tags}
              max={3}
              badgeClassName="text-[10px] font-medium"
              moreClassName="self-center text-[10px] font-medium text-muted-foreground"
              renderMore={count => t("list.moreTags", { count })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
