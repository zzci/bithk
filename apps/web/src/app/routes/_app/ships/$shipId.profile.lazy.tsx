/* eslint-disable react-refresh/only-export-components */
// Profile tab route: full read-only registry/spec fields.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { useShip } from "@/shared/lib/api/ships";
import { ShipProfileTab } from "./-ship-profile-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/profile")({
  component: ShipProfileRoute,
});

function ShipProfileRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/profile" });
  const ship = useShip(shipId).data;
  const canManage = useProjectCapabilities(useProject(ship?.baseProjectId ?? undefined).data).canManageProject;

  if (!ship)
    return null;

  return <ShipProfileTab ship={ship} canManage={canManage} />;
}
