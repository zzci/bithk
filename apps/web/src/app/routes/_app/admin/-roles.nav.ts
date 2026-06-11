import type { NavItem } from "@/shared/components/sidebar/types";
import { UserCog } from "lucide-react";

export const rolesNav: NavItem = {
  area: "admin",
  key: "roles",
  labelKey: "roles:nav",
  path: "/admin/roles",
  icon: UserCog,
  order: 15,
};
