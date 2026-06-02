/* eslint-disable react-refresh/only-export-components */
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipStatus, ShipVesselType, ShipView } from "@/shared/lib/api/ships";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, Loader2, MapPin, Plus, Search, Ship as ShipIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/shared/components/cover-image";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { SHIP_STATUSES, SHIP_VESSEL_TYPES, useCreateShip, useShipCount, useShips } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToCreate } from "./-ship-form-logic";
import { ShipStatusBadge } from "./-ship-visuals";

export const Route = createLazyFileRoute("/_app/ships/")({
  component: ShipsListPage,
});

const TYPE_ALL = "__all__";
const CURRENT_YEAR = new Date().getUTCFullYear();

export function ShipsListPage() {
  const { t } = useTranslation(["ships", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [status, setStatus] = useState<ShipStatus>("active");
  const [type, setType] = useState<string>(TYPE_ALL);
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
    type: type === TYPE_ALL ? undefined : (type as ShipVesselType),
    page,
    q: debouncedSearch,
  });
  const createShip = useCreateShip();

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
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t("list.create")}
          </Button>
        )}
      </div>

      {shipsQuery.error && <ErrorBanner message={errorMessage(shipsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {SHIP_STATUSES.map((s) => {
            const label = t(`status.${s}` as const);
            const count = statusCounts[s];
            return (
              <Button
                key={s}
                variant={status === s ? "default" : "outline"}
                className="h-8 shrink-0 rounded-full"
                aria-pressed={status === s}
                aria-label={count === undefined ? label : `${label} ${count}`}
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
              >
                {label}
                {count !== undefined && (
                  <span className="ml-1 rounded-full bg-background/60 px-1.5 text-xs tabular-nums">{count}</span>
                )}
              </Button>
            );
          })}
          <Select
            value={type}
            onValueChange={(v) => {
              if (v !== null) {
                setType(v);
                setPage(1);
              }
            }}
          >
            <SelectTrigger className="h-8 w-40 shrink-0 rounded-full">
              <SelectValue>
                {(v: string) => (v === TYPE_ALL ? t("list.typeAll") : t(`vesselType.${v}` as const))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TYPE_ALL}>{t("list.typeAll")}</SelectItem>
              {SHIP_VESSEL_TYPES.map(vt => (
                <SelectItem key={vt} value={vt}>{t(`vesselType.${vt}` as const)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("list.searchPlaceholder")}
            aria-label={t("list.searchPlaceholder")}
            className="pl-8"
          />
        </div>
      </div>

      {shipsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
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
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">{t("list.total", { count: meta.total })}</span>
          <div className="flex gap-1">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
          </div>
        </div>
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
      </CardContent>
    </Card>
  );
}
