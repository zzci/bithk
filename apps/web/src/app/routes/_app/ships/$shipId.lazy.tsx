/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Tabs,
  TabsContent,
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
import { useProjectCapabilities } from "../projects/-use-project-role";
import { visibleShipTabs } from "./-ship-tabs";
import { ShipStatusBadge } from "./-ship-visuals";

export const Route = createLazyFileRoute("/_app/ships/$shipId")({
  component: ShipDetailPage,
});

function ShipDetailPage() {
  const { t } = useTranslation(["ships", "common"]);
  const { shipId } = useParams({ from: "/_app/ships/$shipId" });
  const navigate = useNavigate();

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
  const [tab, setTab] = useState("overview");
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const ctx = { ship, canManage };
  const tabs = visibleShipTabs(ctx);

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

      <Tabs value={tab} onValueChange={v => v !== null && setTab(v)}>
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
        {tabs.map(d => (
          <TabsContent key={d.value} value={d.value} className="pt-4">
            {d.render(ctx)}
          </TabsContent>
        ))}
      </Tabs>

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
