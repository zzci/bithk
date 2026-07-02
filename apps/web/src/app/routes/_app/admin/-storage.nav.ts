import type { NavItem } from "@/shared/components/sidebar/types";
import { HardDrive } from "lucide-react";

export const storageNav: NavItem = {
  area: "admin",
  key: "storage",
  path: "/admin/storage",
  icon: HardDrive,
  // After users (10) / policies / audit / cron (…) and settings (40).
  order: 45,
};
