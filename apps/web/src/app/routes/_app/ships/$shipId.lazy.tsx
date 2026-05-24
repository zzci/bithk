/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
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
import { useDeleteShip, useShip } from "@/shared/lib/api/ships";
import { useAuthStore } from "@/shared/stores/auth";
import { useProjectCapabilities } from "../projects/-use-project-role";
import { visibleShipTabs } from "./-ship-tabs";

export const Route = createLazyFileRoute("/_app/ships/$shipId")({
  component: ShipDetailPage,
});

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

  const handleDelete = () => {
    deleteShip.mutate(ship.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        void navigate({ to: "/ships" });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/ships" })}>
          <ArrowLeft className="mr-1 size-4" />
          {t("detail.back")}
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{ship.name}</h1>
            <Badge variant="outline" className="text-xs">{t(`lifecycle.${ship.lifecycleStage}` as const)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{ship.code}</p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1 size-4 text-destructive" />
            {t("common:common.delete")}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={v => v !== null && setTab(v)}>
        <TabsList variant="line">
          {tabs.map(d => (
            <TabsTrigger key={d.value} value={d.value}>{t(d.labelKey)}</TabsTrigger>
          ))}
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
