/* eslint-disable react-refresh/only-export-components */
// Projects tab route: base/related projects for this ship.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProject } from "@/shared/lib/api/projects";
import { useShip } from "@/shared/lib/api/ships";
import { useProjectCapabilities } from "../projects/-use-project-role";
import { ShipProjectsTab } from "./-ship-projects-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/projects")({
  component: ShipProjectsRoute,
});

function ShipProjectsRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/projects" });
  const ship = useShip(shipId).data;
  const canManage = useProjectCapabilities(useProject(ship?.baseProjectId ?? undefined).data).canManageProject;

  if (!ship)
    return null;

  return <ShipProjectsTab ship={ship} canManage={canManage} />;
}
