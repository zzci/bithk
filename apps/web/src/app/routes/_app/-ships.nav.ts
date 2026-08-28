import type { NavItem } from "@/shared/components/sidebar/types";
import { Ship } from "lucide-react";

/**
 * "Ships" is no longer a module of its own — a ship is a PROJECT created with
 * the `ship` preset (PLAN-108). The entry survives as a PRESET LINK into the
 * projects list, narrowed to projects that mount the ship sections, so the
 * fleet stays one click away without a second route tree behind it. It is
 * therefore gated on the `projects` module, not a `ships` one.
 */
export const shipsNav: NavItem = {
  area: "overview",
  key: "ships",
  path: "/projects",
  search: { section: "ship-profile" },
  icon: Ship,
  order: 50,
  module: "projects",
};
