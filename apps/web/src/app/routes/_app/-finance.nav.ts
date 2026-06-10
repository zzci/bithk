import type { NavItem } from "@/shared/components/sidebar/types";
import { Wallet } from "lucide-react";

export const financeNav: NavItem = {
  area: "admin",
  key: "finance",
  labelKey: "finance:nav",
  path: "/finance/colleagues",
  icon: Wallet,
  matchPrefix: "/finance",
  order: 50,
};
