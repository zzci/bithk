/* eslint-disable react-refresh/only-export-components */
// Settings tab route: per-ship configuration (equipment categories, …).

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { useShip } from "@/shared/lib/api/ships";
import { ShipSettingsTab } from "./-ship-settings-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/settings")({
  component: ShipSettingsRoute,
});

function ShipSettingsRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/settings" });
  const ship = useShip(shipId).data;
  const canManage = useProjectCapabilities(useProject(ship?.baseProjectId ?? undefined).data).canManageProject;

  if (!ship)
    return null;

  return <ShipSettingsTab ship={ship} canManage={canManage} />;
}
