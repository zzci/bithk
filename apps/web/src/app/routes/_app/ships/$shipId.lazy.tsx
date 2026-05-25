/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { Anchor, ArrowLeft, ChevronRight, Gauge, MapPin, Ship as ShipIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
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
  useShipMaintenanceOrders,
  useShipMaintenanceTemplates,
  useShipProjects,
} from "@/shared/lib/api/ships";
import { useAuthStore } from "@/shared/stores/auth";
import { useProjectCapabilities } from "../projects/-use-project-role";
import { StatTile } from "./-ship-stats";
import { visibleShipTabs } from "./-ship-tabs";

export const Route = createLazyFileRoute("/_app/ships/$shipId")({
  component: ShipDetailPage,
});

const DETAIL_PORTHOLES = ["a", "b", "c", "d", "e", "f", "g"] as const;

function ShipDetailPage() {
  const { t } = useTranslation(["ships", "common"]);
  const { shipId } = useParams({ from: "/_app/ships/$shipId" });
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const shipQuery = useShip(shipId);
  const ship = shipQuery.data;

  // Permissions are anchored on the base project: its detail payload carries
  // the caller's effective capabilities, from which we derive `project.manage`.
  const baseProjectQuery = useProject(ship?.baseProjectId ?? undefined);
  const caps = useProjectCapabilities(baseProjectQuery.data);
  const canManage = caps.canManageProject;

  // Hero metrics + tab counts. These reuse the same cached queries the tabs
  // mount, so opening a tab is instant after the hero has warmed them.
  const projects = useShipProjects(shipId).data;
  const equipment = useShipEquipment(shipId).data;
  const templates = useShipMaintenanceTemplates(shipId).data;
  const orders = useShipMaintenanceOrders(shipId).data;

  const deleteShip = useDeleteShip();
  const [tab, setTab] = useState("overview");
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (shipQuery.isLoading)
    return <p className="text-muted-foreground">{t("detail.loading")}</p>;

  if (shipQuery.error || !ship) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/ships" })}>
          <ArrowLeft className="mr-1 size-4" />
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
    maintenance: templates === undefined || orders === undefined ? undefined : templates.length + orders.length,
    projects: projects?.length,
  };

  const activeOrderCount = orders?.filter(order => order.status === "open" || order.status === "in_progress").length;
  const retiredEquipmentCount = equipment?.filter(row => row.status === "retired").length;
  const categoryCount = templates === undefined ? undefined : new Set(templates.map(template => template.category?.trim()).filter(Boolean)).size;

  const handleDelete = () => {
    deleteShip.mutate(ship.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        void navigate({ to: "/ships" });
      },
    });
  };

  const metric = (value: number | undefined) => (value === undefined ? "—" : value);

  return (
    <div className="space-y-6 rounded-2xl bg-background p-1 md:p-3">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label={t("detail.back")}>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => void navigate({ to: "/ships" })}
        >
          <ArrowLeft className="size-4" />
          {t("page.title")}
        </button>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">{ship.name}</span>
      </nav>

      <section className="grid gap-5 overflow-hidden rounded-xl border bg-card p-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="relative min-h-44 overflow-hidden rounded-lg border bg-muted/30">
          <DetailShipIllustration />
          <div className="absolute right-3 bottom-3 left-3 flex items-center gap-2 rounded-md bg-background/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <ShipIcon className="size-4 text-primary" />
            <span className="truncate font-mono font-medium">{ship.code}</span>
            {ship.imoNumber && <span className="truncate text-muted-foreground">{ship.imoNumber}</span>}
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs">{t(`lifecycle.${ship.lifecycleStage}` as const)}</Badge>
                <Badge variant="secondary" className="text-xs">{t(`status.${ship.status}` as const)}</Badge>
                {ship.flagState && <Badge variant="ghost" className="text-xs">{ship.flagState}</Badge>}
                {ship.registryPort && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    <MapPin className="size-3" />
                    {ship.registryPort}
                  </span>
                )}
              </div>
              <h1 className="truncate text-2xl font-bold">{ship.name}</h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-mono">{ship.code}</span>
                {ship.imoNumber && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-mono">{ship.imoNumber}</span>
                  </>
                )}
                {ship.baseProjectId && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {t("detail.baseProject")}
                      {" "}
                      <span className="font-mono text-primary">{ship.baseProjectId}</span>
                    </span>
                  </>
                )}
              </p>
            </div>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1 size-4 text-destructive" />
                {t("common:common.delete")}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label={t("detail.metrics.projects")}
              value={metric(projects?.length)}
              hint={projects ? t("detail.metricHints.projects", { base: projects.filter(project => project.isBase).length, linked: projects.filter(project => !project.isBase).length }) : undefined}
            />
            <StatTile
              label={t("detail.metrics.equipment")}
              value={metric(equipment?.length)}
              hint={retiredEquipmentCount === undefined ? undefined : t("detail.metricHints.equipment", { count: retiredEquipmentCount })}
            />
            <StatTile
              label={t("detail.metrics.templates")}
              value={metric(templates?.length)}
              hint={categoryCount === undefined ? undefined : t("detail.metricHints.templates", { count: categoryCount })}
            />
            <StatTile
              label={t("detail.metrics.workOrders")}
              value={metric(orders?.length)}
              hint={activeOrderCount === undefined ? undefined : t("detail.metricHints.workOrders", { count: activeOrderCount })}
            />
          </div>
        </div>
      </section>

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

function DetailShipIllustration() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-x-0 bottom-0 h-16 bg-primary/10" />
      <div className="absolute right-8 bottom-14 left-8 h-14 rounded-b-full bg-foreground/85" />
      <div className="absolute bottom-[6.25rem] left-1/2 h-11 w-24 -translate-x-1/2 rounded-t-md bg-foreground/75" />
      <div className="absolute bottom-[9rem] left-1/2 h-12 w-1 -translate-x-1/2 bg-foreground/70" />
      <div className="absolute right-7 bottom-8 left-7 flex justify-between text-primary/25">
        {DETAIL_PORTHOLES.map(key => (
          <Gauge key={key} className="size-4" aria-hidden="true" />
        ))}
      </div>
      <Anchor className="absolute top-4 right-4 size-5 text-primary/40" aria-hidden="true" />
    </div>
  );
}
