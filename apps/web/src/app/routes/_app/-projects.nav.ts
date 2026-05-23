import type { NavItem } from "@/shared/components/sidebar/types";
import { Layers } from "lucide-react";

export const projectsNav: NavItem = {
  area: "overview",
  key: "projects",
  path: "/projects",
  icon: Layers,
  order: 40,
};
