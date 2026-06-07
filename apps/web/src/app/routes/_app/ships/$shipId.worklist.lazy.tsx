/* eslint-disable react-refresh/only-export-components */
// Worklist tab route.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { useShip } from "@/shared/lib/api/ships";
import { ShipWorklistTab } from "./-ship-worklist-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/worklist")({
  component: ShipWorklistRoute,
});

function ShipWorklistRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/worklist" });
  const ship = useShip(shipId).data;
  const canManage = useProjectCapabilities(useProject(ship?.baseProjectId ?? undefined).data).canManageProject;

  if (!ship)
    return null;

  return <ShipWorklistTab ship={ship} canManage={canManage} />;
}
