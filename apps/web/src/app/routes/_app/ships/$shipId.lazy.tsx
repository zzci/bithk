/* eslint-disable react-refresh/only-export-components */
import type { ShipDetailTab } from "./-ship-tabs";
import { createLazyFileRoute, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { useProject } from "@/shared/lib/api/projects";
import {
  useDeleteShip,
  useShip,
  useShipEquipment,
  useShipProjects,
  useShipWorklists,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useProjectCapabilities } from "../projects/-use-project-role";
import { activeShipTab, SHIP_TAB_TO, visibleShipTabs } from "./-ship-tabs";
import { ShipStatusBadge } from "./-ship-visuals";

export const Route = createLazyFileRoute("/_app/ships/$shipId")({
  component: ShipDetailLayout,
});

function ShipDetailLayout() {
  const { t } = useTranslation(["ships", "common"]);
  const { shipId } = useParams({ from: "/_app/ships/$shipId" });
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const shipQuery = useShip(shipId);
  const ship = shipQuery.data;

  // Single permission anchor for the whole detail page: a ship can be modified
  // by an app-admin OR a holder of `project.manage` on its base project. The
  // base project's detail payload carries those capabilities; when there is no
  // base project, `useProjectCapabilities` still grants admins everything and
  // denies everyone else — i.e. admin-only. The page delete, every tab gate,
  // and the files tab all read this one `canManage`.
  const baseProjectQuery = useProject(ship?.baseProjectId ?? undefined);
  const caps = useProjectCapabilities(baseProjectQuery.data);
  const canManage = caps.canManageProject;

  // These reuse the same cached queries the tabs mount and feed the tab-count
  // badges below.
  const projects = useShipProjects(shipId).data;
  const equipment = useShipEquipment(shipId).data;
  const worklists = useShipWorklists(shipId).data;

  const deleteShip = useDeleteShip();
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The active tab is derived from the path (one route per tab) so back/forward
  // and shareable URLs always resolve to the correct tab.
  const tab = activeShipTab(pathname, shipId);
  const goToTab = (value: ShipDetailTab) => {
    void navigate({ to: SHIP_TAB_TO[value], params: { shipId } });
  };

  if (shipQuery.isLoading)
    return <p className="text-muted-foreground">{t("detail.loading")}</p>;

  if (shipQuery.error || !ship) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => void navigate({ to: "/ships" })}>
          <ArrowLeft aria-hidden="true" />
          {t("detail.back")}
        </Button>
        <ErrorBanner message={t("detail.notFound")} />
      </div>
    );
  }

  const tabs = visibleShipTabs({ ship, canManage });

  const tabCounts: Record<string, number | undefined> = {
    profile: 1,
    equipment: equipment?.length,
    worklist: worklists?.length,
    projects: projects?.length,
  };

  const handleDelete = () => {
    deleteShip.mutate(ship.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        void navigate({ to: "/ships" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, t("common:common.error.deleteFailed")));
      },
    });
  };

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        className="-ml-2 h-8 px-2 text-muted-foreground"
        onClick={() => void navigate({ to: "/ships" })}
      >
        <ArrowLeft aria-hidden="true" />
        {t("detail.back")}
      </Button>

      {/* Compact header — name + status, then code/IMO/flag/port/base-project inline on one meta row. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold">{ship.name}</h1>
            <ShipStatusBadge status={ship.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{ship.code}</span>
            {ship.imoNumber && <span className="font-mono">{ship.imoNumber}</span>}
            {ship.flagState && <span>{ship.flagState}</span>}
            {ship.registryPort && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {ship.registryPort}
              </span>
            )}
            {ship.baseProjectId && (
              <span>
                {t("detail.baseProject")}
                {" "}
                <span className="font-mono text-primary">{ship.baseProjectId}</span>
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <Button variant="outline" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="text-destructive" aria-hidden="true" />
            {t("common:common.delete")}
          </Button>
        )}
      </div>

      {/* Tabs promoted to the page's primary navigation; each tab is a route. */}
      <Tabs value={tab} onValueChange={v => v !== null && goToTab(v as ShipDetailTab)}>
        <TabsList variant="line">
          {tabs.map((d) => {
            const count = tabCounts[d.value];
            return (
              <TabsTrigger key={d.value} value={d.value}>
                {t(d.labelKey)}
                {count != null && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* The active tab route renders here. */}
      <div className="pt-4">
        <Outlet />
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("delete.title")}
        description={t("delete.confirm", { name: ship.name })}
        pending={deleteShip.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
