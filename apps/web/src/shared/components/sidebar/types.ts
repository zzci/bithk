import type { LucideIcon } from "lucide-react";

export type NavArea = "overview" | "admin";

// Gateable module keys — must stay in sync with the backend registry
// (`apps/api/src/shared/modules.ts`), which computes the `modules` list
// `/account/me` returns.
export type ModuleKey = "documents" | "drive" | "projects" | "ships" | "contacts" | "hr";

export interface NavItem {
  readonly area: NavArea;
  readonly key: string;
  readonly labelKey?: string;
  readonly path: string;
  readonly icon: LucideIcon;
  readonly matchPrefix?: string;
  readonly order: number;
  // When set, the item is visible only to users whose `me.modules` contains
  // this key. Items without it are always visible within their area.
  readonly module?: ModuleKey;
}
