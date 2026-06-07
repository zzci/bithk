/* eslint-disable react-refresh/only-export-components */
// Overview tab route (ship index). The detail layout guarantees the ship is
// loaded before this Outlet renders; the cached query resolves immediately.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { useShip } from "@/shared/lib/api/ships";
import { ShipOverviewTab } from "./-ship-overview-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/")({
  component: ShipOverviewRoute,
});

function ShipOverviewRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/" });
  const ship = useShip(shipId).data;
  const canManage = useProjectCapabilities(useProject(ship?.baseProjectId ?? undefined).data).canManageProject;

  if (!ship)
    return null;

  return <ShipOverviewTab ship={ship} canManage={canManage} />;
}
