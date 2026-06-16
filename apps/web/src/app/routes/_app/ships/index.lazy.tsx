/* eslint-disable react-refresh/only-export-components */
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipStatus, ShipView } from "@/shared/lib/api/ships";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CoverImage } from "@/shared/components/cover-image";
import { ListFilter } from "@/shared/components/list-filter";
import { CardGridSkeleton } from "@/shared/components/list-skeleton";
import { PageHeader } from "@/shared/components/page-header";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { TagChips, tagFilterDimension } from "@/shared/components/tags";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Spinner } from "@/shared/components/ui/spinner";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { SHIP_STATUSES, useCreateShip, useShips, useShipStatusCounts, useShipTags } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToCreate } from "./-ship-form-logic";
import { ShipStatusBadge } from "./-ship-visuals";

export const Route = createLazyFileRoute("/_app/ships/")({
  component: ShipsListPage,
});

export function ShipsListPage() {
  const { t } = useTranslation(["ships", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  // null = no status filter → backend default view (every status except retired).
  const [status, setStatus] = useState<ShipStatus | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
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
    status: status ?? undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    page,
    q: debouncedSearch,
  });
  const createShip = useCreateShip();
  const shipTags = useShipTags().data ?? [];

  // Per-status fleet KPIs from a dedicated status-keyed count query, stable
  // across the main list's pagination and search.
  const statusCounts = useShipStatusCounts();
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

  const tagDim = tagFilterDimension({
    tags: shipTags,
    value: tagIds,
    onChange: (value) => {
      setTagIds(value);
      setPage(1);
    },
    label: t("field.tags"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={(
          <span className="flex items-center gap-2">
            {t("page.title")}
            {isRefetching && (
              <Spinner aria-hidden={false} className="text-muted-foreground" aria-label={t("list.loading")} />
            )}
          </span>
        )}
        description={t("page.description")}
      />

      {shipsQuery.error && <ErrorBanner message={errorMessage(shipsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListFilter
          dimensions={[
            {
              key: "status",
              label: t("field.status"),
              mode: "single",
              value: status,
              onChange: (value) => {
                setStatus(value as ShipStatus | null);
                setPage(1);
              },
              options: SHIP_STATUSES.map(s => ({
                value: s,
                label: t(`status.${s}` as const),
                count: statusCounts[s],
              })),
            },
            ...(tagDim ? [tagDim] : []),
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
  const { t } = useTranslation(["ships", "common"]);

  const specs = [
    { label: t("field.lengthOverall"), value: ship.lengthOverall === null ? null : String(ship.lengthOverall) },
    { label: t("field.beam"), value: ship.beam === null ? null : String(ship.beam) },
    { label: t("field.draft"), value: ship.draft === null ? null : String(ship.draft) },
    { label: t("field.airDraft"), value: ship.airDraft === null ? null : String(ship.airDraft) },
    { label: t("field.grossTonnage"), value: ship.grossTonnage === null ? null : String(ship.grossTonnage) },
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
      <CoverImage src={ship.coverImageUrl} kind="ship" enableLightbox className="h-28 w-full" />
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="truncate">{ship.name}</CardTitle>
            <div className="space-y-1">
              <CardIdentifier label={t("list.card.imo")} value={ship.imoNumber} />
              <CardIdentifier label={t("list.card.mmsi")} value={ship.mmsi} />
              <CardIdentifier label={t("list.card.location")} value={ship.registryPort} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ShipStatusBadge status={ship.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {specs.map(spec => (
            <div key={spec.label} className="min-w-0">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">{spec.label}</dt>
              <dd className="truncate font-mono text-xs">
                {spec.value ?? <span className="text-muted-foreground">{t("overview.notSet")}</span>}
              </dd>
            </div>
          ))}
        </dl>

        {ship.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <TagChips
              tags={ship.tags}
              max={3}
              className="text-2xs font-medium"
              moreClassName="self-center text-2xs font-medium text-muted-foreground"
              renderMore={count => t("list.moreTags", { count })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// One identifier row in the card header: a leading copy button, a label, and the
// value (or the "not set" placeholder). The card itself is a clickable nav
// surface, so the copy handler stops propagation to avoid opening the ship.
function CardIdentifier({ label, value }: { readonly label: string; readonly value: string | null }) {
  const { t } = useTranslation(["ships", "common"]);
  const { copy } = useCopyToClipboard();

  const handleCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (value === null)
      return;
    copy(value);
    toast.success(t("common:common.copied"));
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 text-muted-foreground"
        aria-label={t("common:common.copy")}
        disabled={value === null}
        onClick={handleCopy}
      >
        <Copy className="size-3" aria-hidden="true" />
      </Button>
      <span className="text-xs font-medium text-foreground/70">{label}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">{value ?? t("overview.notSet")}</span>
    </div>
  );
}
