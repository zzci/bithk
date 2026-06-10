import type { NavItem } from "@/shared/components/sidebar/types";
import { Ship } from "lucide-react";

export const shipsNav: NavItem = {
  area: "overview",
  key: "ships",
  path: "/ships",
  icon: Ship,
  order: 50,
  module: "ships",
};
