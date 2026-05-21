import type { NavItem } from "@/shared/components/sidebar/types";
import { HardDrive } from "lucide-react";

export const driveNav: NavItem = {
  area: "portal",
  key: "drive",
  labelKey: "drive:nav",
  path: "/portal/drive",
  icon: HardDrive,
  order: 35,
};
