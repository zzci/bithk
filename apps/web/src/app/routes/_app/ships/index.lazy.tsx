/* eslint-disable react-refresh/only-export-components */
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipLifecycleStage, ShipView } from "@/shared/lib/api/ships";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Anchor, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { SHIP_LIFECYCLE_STAGES, useCreateShip, useShips } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToCreate } from "./-ship-form-logic";
import { StatTile } from "./-ship-stats";

export const Route = createLazyFileRoute("/_app/ships/")({
  component: ShipsListPage,
});

const STAGE_ALL = "__all__";

/** Fleet-wide count for a lifecycle stage, read from the list endpoint's meta. */
function useStageCount(stage?: ShipLifecycleStage): number | undefined {
  return useShips(stage ? { lifecycleStage: stage } : {}).data?.meta.total;
}

export function ShipsListPage() {
  const { t } = useTranslation(["ships", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [stage, setStage] = useState<string>(STAGE_ALL);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const shipsQuery = useShips({
    lifecycleStage: stage === STAGE_ALL ? undefined : (stage as ShipLifecycleStage),
    page,
  });
  const createShip = useCreateShip();

  // Fleet KPIs: each is the `meta.total` of a stage-scoped list query, so the
  // numbers are accurate across pages rather than just the visible slice.
  const totalCount = useStageCount();
  const maintenanceCount = useStageCount("maintenance");
  const buildingCount = useStageCount("building");
  const seaTrialCount = useStageCount("sea_trial");
  const inServiceCount = useStageCount("in_service");
  const buildTrialCount
    = buildingCount === undefined && seaTrialCount === undefined
      ? undefined
      : (buildingCount ?? 0) + (seaTrialCount ?? 0);

  const ships = useMemo(() => shipsQuery.data?.data ?? [], [shipsQuery.data]);
  const meta = shipsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  // Client-side refinement of the loaded page (no text-search API yet).
  const visibleShips = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q)
      return ships;
    return ships.filter(s =>
      [s.name, s.code, s.imoNumber].some(v => v?.toLowerCase().includes(q)),
    );
  }, [ships, search]);

  const handleCreate = (state: ShipFormState) => {
    createShip.mutate(shipFormToCreate(state), {
      onSuccess: (ship) => {
        setCreateOpen(false);
        void navigate({ to: "/ships/$shipId", params: { shipId: ship.id } });
      },
    });
  };

  const kpi = (value: number | undefined) => (value === undefined ? "—" : value);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("page.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("list.create")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("list.kpi.total")} value={kpi(totalCount)} />
        <StatTile label={t("list.kpi.inService")} value={kpi(inServiceCount)} />
        <StatTile label={t("list.kpi.maintenance")} value={kpi(maintenanceCount)} />
        <StatTile label={t("list.kpi.buildingTrial")} value={kpi(buildTrialCount)} />
      </div>

      {shipsQuery.error && <ErrorBanner message={errorMessage(shipsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("list.filterByStage")}</span>
          {[
            { key: STAGE_ALL, label: t("list.stageAll") },
            ...SHIP_LIFECYCLE_STAGES.map(s => ({ key: s, label: t(`lifecycle.${s}` as const) })),
          ].map(opt => (
            <Button
              key={opt.key}
              size="sm"
              variant={stage === opt.key ? "default" : "outline"}
              className="h-8 rounded-full"
              aria-pressed={stage === opt.key}
              onClick={() => {
                setStage(opt.key);
                setPage(1);
              }}
            >
              {opt.label}
            </Button>
          ))}
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
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : visibleShips.length === 0
            ? <p className="text-sm text-muted-foreground">{t("list.noMatches")}</p>
            : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleShips.map(ship => (
                    <ShipCard
                      key={ship.id}
                      ship={ship}
                      onOpen={() => void navigate({ to: "/ships/$shipId", params: { shipId: ship.id } })}
                    />
                  ))}
                </div>
              )}

      {totalPages > 1 && meta && (
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">{t("list.total", { count: meta.total })}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("common:common.prev")}</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common:common.next")}</Button>
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
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left ring-1 ring-foreground/5 transition-all hover:border-border hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-base leading-snug font-medium">{ship.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{ship.code}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {t(`lifecycle.${ship.lifecycleStage}` as const)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-dashed pt-3">
        {specs.map(spec => (
          <div key={spec.label} className="min-w-0">
            <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{spec.label}</dt>
            <dd className="truncate font-mono text-xs">
              {spec.value ?? <span className="text-muted-foreground">{t("overview.notSet")}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-dashed pt-3">
        {ship.registryPort && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
            <Anchor className="size-3" />
            {ship.registryPort}
          </span>
        )}
        {ship.status === "archived" && (
          <Badge variant="secondary" className="text-xs">{t("status.archived")}</Badge>
        )}
      </div>
    </button>
  );
}
