/* eslint-disable react-refresh/only-export-components */
// Equipment tab route.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProject } from "@/shared/lib/api/projects";
import { useShip } from "@/shared/lib/api/ships";
import { useProjectCapabilities } from "../projects/-use-project-role";
import { ShipEquipmentTab } from "./-ship-equipment-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/equipment")({
  component: ShipEquipmentRoute,
});

function ShipEquipmentRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/equipment" });
  const ship = useShip(shipId).data;
  const canManage = useProjectCapabilities(useProject(ship?.baseProjectId ?? undefined).data).canManageProject;

  if (!ship)
    return null;

  return <ShipEquipmentTab ship={ship} canManage={canManage} />;
}
