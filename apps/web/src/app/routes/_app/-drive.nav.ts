import type { NavItem } from "@/shared/components/sidebar/types";
import { HardDrive } from "lucide-react";

export const driveNav: NavItem = {
  area: "overview",
  key: "drive",
  labelKey: "drive:nav",
  path: "/drive",
  icon: HardDrive,
  order: 35,
};
