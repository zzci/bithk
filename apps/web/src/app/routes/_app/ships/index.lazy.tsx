/* eslint-disable react-refresh/only-export-components */
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipLifecycleStage } from "@/shared/lib/api/ships";
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { SHIP_LIFECYCLE_STAGES, useCreateShip, useShips } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToCreate } from "./-ship-form-logic";

export const Route = createLazyFileRoute("/_app/ships/")({
  component: ShipsListPage,
});

const STAGE_ALL = "__all__";

export function ShipsListPage() {
  const { t } = useTranslation(["ships", "common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const [stage, setStage] = useState<string>(STAGE_ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const shipsQuery = useShips({
    lifecycleStage: stage === STAGE_ALL ? undefined : (stage as ShipLifecycleStage),
    page,
  });
  const createShip = useCreateShip();

  const ships = shipsQuery.data?.data ?? [];
  const meta = shipsQuery.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;

  const handleCreate = (state: ShipFormState) => {
    createShip.mutate(shipFormToCreate(state), {
      onSuccess: (ship) => {
        setCreateOpen(false);
        void navigate({ to: "/ships/$shipId", params: { shipId: ship.id } });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
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

      {shipsQuery.error && <ErrorBanner message={errorMessage(shipsQuery.error, t("common:common.error.loadFailed"))} />}

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
            onClick={() => {
              setStage(opt.key);
              setPage(1);
            }}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {shipsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        : ships.length === 0
          ? <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ships.map(ship => (
                  <Card
                    key={ship.id}
                    size="sm"
                    className="cursor-pointer transition-colors hover:ring-foreground/20"
                    onClick={() => void navigate({ to: "/ships/$shipId", params: { shipId: ship.id } })}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="line-clamp-2">{ship.name}</CardTitle>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {t(`lifecycle.${ship.lifecycleStage}` as const)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{ship.code}</p>
                    </CardHeader>
                    {ship.status === "archived" && (
                      <CardContent>
                        <Badge variant="secondary" className="text-xs">{t("status.archived")}</Badge>
                      </CardContent>
                    )}
                  </Card>
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
