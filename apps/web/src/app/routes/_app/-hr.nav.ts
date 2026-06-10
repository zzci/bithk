import type { NavItem } from "@/shared/components/sidebar/types";
import { IdCard } from "lucide-react";

export const hrNav: NavItem = {
  area: "admin",
  key: "hr",
  labelKey: "hr:nav",
  path: "/hr/colleagues",
  icon: IdCard,
  matchPrefix: "/hr",
  order: 50,
};
