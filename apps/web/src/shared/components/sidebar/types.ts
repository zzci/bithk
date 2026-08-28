import type { LucideIcon } from "lucide-react";

export type NavArea = "overview" | "admin";

// Gateable module keys — must stay in sync with the backend registry
// (`apps/api/src/shared/modules.ts`), which computes the `modules` list
// `/account/me` returns.
export type ModuleKey = "documents" | "drive" | "projects" | "contacts" | "hr";

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
  // Preset entries point at another module's list with a filter pre-applied
  // (e.g. "Ships" = the projects list narrowed to ship-section projects). Two
  // entries can therefore share one `path`; the search params tell them apart,
  // both when navigating and when deciding which one reads as active.
  readonly search?: Readonly<Record<string, string>>;
}
