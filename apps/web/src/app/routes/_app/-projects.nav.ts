import type { NavItem } from "@/shared/components/sidebar/types";
import { Briefcase } from "lucide-react";

export const projectsNav: NavItem = {
  area: "overview",
  key: "projects",
  path: "/projects",
  icon: Briefcase,
  order: 40,
};
