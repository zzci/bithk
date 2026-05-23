import type { NavItem } from "@/shared/components/sidebar/types";
import { Briefcase } from "lucide-react";

export const projectsNav: NavItem = {
  area: "portal",
  key: "projects",
  path: "/portal/projects",
  icon: Briefcase,
  order: 40,
};
