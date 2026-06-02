/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, ClipboardList, FolderKanban, MapPin, Package, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/shared/components/cover-image";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
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
import { useProjectCapabilities } from "../projects/-use-project-role";
import { StatTile } from "./-ship-stats";
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

  // Hero metrics + tab counts. These reuse the same cached queries the tabs
  // mount, so opening a tab is instant after the hero has warmed them. We keep
  // the query objects (not just `.data`) so a failed metric surfaces an error
  // + retry instead of an indefinite "—".
  const projectsQuery = useShipProjects(shipId);
  const equipmentQuery = useShipEquipment(shipId);
  const templatesQuery = useShipMaintenanceTemplates(shipId);
  const ordersQuery = useShipMaintenanceOrders(shipId);
  const projects = projectsQuery.data;
  const equipment = equipmentQuery.data;
  const templates = templatesQuery.data;
  const orders = ordersQuery.data;

  const heroQueries = [projectsQuery, equipmentQuery, templatesQuery, ordersQuery];
  const heroError = heroQueries.some(q => q.isError);
  const retryHeroMetrics = () => {
    for (const q of heroQueries)
      void q.refetch();
  };

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
    maintenance: templates === undefined || orders === undefined ? undefined : templates.length + orders.length,
    projects: projects?.length,
  };

  const activeOrderCount = orders?.filter(order => order.status === "todo" || order.status === "working" || order.status === "review").length;
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
    <div className="space-y-5">
      <Button
        variant="ghost"
        className="-ml-2 h-8 px-2 text-muted-foreground"
        onClick={() => void navigate({ to: "/ships" })}
      >
        <ArrowLeft aria-hidden="true" />
        {t("detail.back")}
      </Button>

      <Card>
        <CoverImage src={ship.coverImageUrl} kind="ship" className="h-40 w-full" />
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <ShipStatusBadge status={ship.status} />
                {ship.flagState && (
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {ship.flagState}
                  </span>
                )}
                {ship.registryPort && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    <MapPin className="size-3" />
                    {ship.registryPort}
                  </span>
                )}
              </div>
              <h1 className="truncate text-2xl font-semibold">{ship.name}</h1>
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
            {canManage && (
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="text-destructive" aria-hidden="true" />
                {t("common:common.delete")}
              </Button>
            )}
          </div>

          {heroError && (
            <div className="space-y-2">
              <ErrorBanner message={t("common:common.error.loadFailed")} />
              <Button variant="outline" size="sm" onClick={retryHeroMetrics}>
                {t("common:common.retry")}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              icon={<FolderKanban />}
              accent="bg-accent-maint/10 text-accent-maint"
              label={t("detail.metrics.projects")}
              value={metric(projects?.length)}
              hint={projects ? t("detail.metricHints.projects", { base: projects.filter(project => project.isBase).length, linked: projects.filter(project => !project.isBase).length }) : undefined}
            />
            <StatTile
              icon={<Package />}
              accent="bg-success/10 text-success"
              label={t("detail.metrics.equipment")}
              value={metric(equipment?.length)}
              hint={retiredEquipmentCount === undefined ? undefined : t("detail.metricHints.equipment", { count: retiredEquipmentCount })}
            />
            <StatTile
              icon={<ClipboardList />}
              accent="bg-info/10 text-info"
              label={t("detail.metrics.templates")}
              value={metric(templates?.length)}
              hint={categoryCount === undefined ? undefined : t("detail.metricHints.templates", { count: categoryCount })}
            />
            <StatTile
              icon={<Wrench />}
              accent="bg-warning/10 text-warning"
              label={t("detail.metrics.workOrders")}
              value={metric(orders?.length)}
              hint={activeOrderCount === undefined ? undefined : t("detail.metricHints.workOrders", { count: activeOrderCount })}
            />
          </div>
        </CardContent>
      </Card>

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
