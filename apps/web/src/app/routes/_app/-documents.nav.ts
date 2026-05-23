import type { NavItem } from "@/shared/components/sidebar/types";
import { Book } from "lucide-react";

export const documentsNav: NavItem = {
  area: "overview",
  key: "documents",
  path: "/documents",
  icon: Book,
  order: 30,
};
