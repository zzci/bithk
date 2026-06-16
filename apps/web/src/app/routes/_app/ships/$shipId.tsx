import { createFileRoute } from "@tanstack/react-router";

export interface ShipDetailSearch {
  /** When true, the ship settings dialog opens on mount (deep link). */
  readonly settings?: boolean;
}

export function validateShipDetailSearch(search: Record<string, unknown>): ShipDetailSearch {
  const settings = search.settings === true || search.settings === "true";
  return settings ? { settings: true } : {};
}

export const Route = createFileRoute("/_app/ships/$shipId")({
  validateSearch: validateShipDetailSearch,
});
