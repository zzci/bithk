import type { NavItem } from "@/shared/components/sidebar/types";
import { ContactRound } from "lucide-react";

export const contactsNav: NavItem = {
  area: "overview",
  key: "contacts",
  path: "/contacts",
  icon: ContactRound,
  order: 55,
};
