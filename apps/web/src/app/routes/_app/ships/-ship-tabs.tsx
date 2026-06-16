// Ship detail tab registry.
//
// Ship detail tabs are first-class routes (one URL per tab) rather than local
// `useState`, so deep links, browser back/forward, and shareable URLs all
// resolve to the correct tab. This file is the framework-free source of truth
// for tab metadata: the layout sorts this registry by `order` to render the tab
// nav, and the pure `SHIP_TAB_TO` / `activeShipTab` helpers map between a tab key
// and its route — kept router-free so they are unit-testable without a router.
//
// Each tab BODY lives in its own `$shipId.<seg>.lazy.tsx` route file; the
// registry no longer renders bodies, so adding a tab means adding an entry here
// plus a `$shipId.<seg>.{tsx,lazy.tsx}` pair.
//
// Reserved order slots (leave gaps so new tabs slot in cleanly):
//    5  Projects   — promoted to the first trigger
//   10  Overview   — index route (`/ships/$shipId`)
//   20  Profile    — full read-only registry/spec fields
//   30  Equipment
//   40  Worklist
//   60  Files
//
// Contract for new tabs:
//   - `value`     stable id used for the Tabs value + React key; also the path
//                 segment (except overview, which is the index).
//   - `labelKey`  i18n key in the `ships` namespace (e.g. "tabs.equipment").
//   - `order`     sort position; pick an unused slot above.
//   - `isVisible` optional gate; omit for always-visible. Receives the same
//                 ShipTabContext (ship + canManage) the route bodies get.

import type { ShipView } from "@/shared/lib/api/ships";

export interface ShipTabContext {
  readonly ship: ShipView;
  /** True when the caller holds `project.manage` on the base project (or is an app admin). */
  readonly canManage: boolean;
}

export interface ShipTabDefinition {
  readonly value: string;
  readonly labelKey: string;
  readonly order: number;
  readonly isVisible?: (ctx: ShipTabContext) => boolean;
}

export const SHIP_TABS: readonly ShipTabDefinition[] = [
  { value: "overview", labelKey: "tabs.overview", order: 10 },
  { value: "profile", labelKey: "tabs.profile", order: 20 },
  { value: "equipment", labelKey: "tabs.equipment", order: 30 },
  { value: "worklist", labelKey: "tabs.worklist", order: 40 },
  { value: "projects", labelKey: "tabs.projects", order: 5 },
  { value: "files", labelKey: "tabs.files", order: 60 },
];

/** Registry entries visible for the given context, sorted by `order`. */
export function visibleShipTabs(ctx: ShipTabContext): readonly ShipTabDefinition[] {
  return SHIP_TABS
    .filter(tab => tab.isVisible?.(ctx) ?? true)
    .toSorted((a, b) => a.order - b.order);
}

export type ShipDetailTab = "overview" | "profile" | "equipment" | "worklist" | "projects" | "files";

// TanStack `to` templates for each tab; `overview` is the ship index.
export const SHIP_TAB_TO: Record<ShipDetailTab, string> = {
  overview: "/ships/$shipId",
  profile: "/ships/$shipId/profile",
  equipment: "/ships/$shipId/equipment",
  worklist: "/ships/$shipId/worklist",
  projects: "/ships/$shipId/projects",
  files: "/ships/$shipId/files",
};

/**
 * Resolve the active tab from a pathname. Unknown / index paths fall back to
 * `overview`; nested detail routes still resolve to their owning tab so the tab
 * nav stays highlighted while a drawer overlays it.
 */
export function activeShipTab(pathname: string, shipId: string): ShipDetailTab {
  const base = `/ships/${shipId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const segment = rest.split("/").filter(Boolean)[0];
  if (segment === "profile")
    return "profile";
  if (segment === "equipment")
    return "equipment";
  if (segment === "worklist")
    return "worklist";
  if (segment === "projects")
    return "projects";
  if (segment === "files")
    return "files";
  return "overview";
}
