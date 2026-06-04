/* eslint-disable react-refresh/only-export-components */
// Files tab route: the ship-scoped drive surface.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useShip } from "@/shared/lib/api/ships";
import { ShipFilesTab } from "./-ship-files-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/files")({
  component: ShipFilesRoute,
});

function ShipFilesRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/files" });
  const ship = useShip(shipId).data;

  if (!ship)
    return null;

  return <ShipFilesTab ship={ship} />;
}
