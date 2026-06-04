/* eslint-disable react-refresh/only-export-components */
// Profile tab route: full read-only registry/spec fields.

import { createLazyFileRoute, useParams } from "@tanstack/react-router";
import { useShip } from "@/shared/lib/api/ships";
import { ShipProfileTab } from "./-ship-profile-tab";

export const Route = createLazyFileRoute("/_app/ships/$shipId/profile")({
  component: ShipProfileRoute,
});

function ShipProfileRoute() {
  const { shipId } = useParams({ from: "/_app/ships/$shipId/profile" });
  const ship = useShip(shipId).data;

  if (!ship)
    return null;

  return <ShipProfileTab ship={ship} />;
}
