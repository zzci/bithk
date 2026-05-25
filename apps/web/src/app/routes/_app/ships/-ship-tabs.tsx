// Ship detail tab registry.
//
// The detail page is intentionally data-driven: it sorts this registry by
// `order` and renders a trigger + panel for each entry generically. T5b extends
// the ship detail by ADDING entries here (each in its own component file) — it
// must not need to edit the Overview / Projects / Files tabs below.
//
// Reserved order slots (leave gaps so new tabs slot in cleanly):
//   10  Overview     — this file
//   20  Profile      — full read-only registry/spec fields
//   30  Equipment    — T5b: add { value: "equipment", labelKey: "tabs.equipment", order: 30, render: … }
//                      backed by a new `-ship-equipment-tab.tsx`
//   40  Maintenance  — T5b: add { value: "maintenance", labelKey: "tabs.maintenance", order: 40, render: … }
//                      backed by a new `-ship-maintenance-tab.tsx`
//   50  Projects     — this file
//   60  Files        — this file
//
// Contract for new tabs:
//   - `value`     stable id used for the Tabs value + React key (also the
//                 `?tab=` candidate if deep-linking is added later).
//   - `labelKey`  i18n key in the `ships` namespace (e.g. "tabs.equipment").
//   - `order`     sort position; pick an unused slot above.
//   - `render`    returns the tab body element. Return a component element —
//                 do NOT call hooks directly here; put data hooks inside the
//                 tab component so they run within the panel's render tree.
//   - `isVisible` optional gate; omit for always-visible. Receives the same
//                 ShipTabContext (ship + canManage) the panels get.

import type { ReactNode } from "react";
import type { ShipView } from "@/shared/lib/api/ships";
import { ShipEquipmentTab } from "./-ship-equipment-tab";
import { ShipFilesTab } from "./-ship-files-tab";
import { ShipMaintenanceTab } from "./-ship-maintenance-tab";
import { ShipOverviewTab } from "./-ship-overview-tab";
import { ShipProfileTab } from "./-ship-profile-tab";
import { ShipProjectsTab } from "./-ship-projects-tab";

export interface ShipTabContext {
  readonly ship: ShipView;
  /** True when the caller holds `project.manage` on the base project (or is an app admin). */
  readonly canManage: boolean;
}

export interface ShipTabDefinition {
  readonly value: string;
  readonly labelKey: string;
  readonly order: number;
  readonly render: (ctx: ShipTabContext) => ReactNode;
  readonly isVisible?: (ctx: ShipTabContext) => boolean;
}

export const SHIP_TABS: readonly ShipTabDefinition[] = [
  {
    value: "overview",
    labelKey: "tabs.overview",
    order: 10,
    render: ctx => <ShipOverviewTab ship={ctx.ship} canManage={ctx.canManage} />,
  },
  {
    value: "profile",
    labelKey: "tabs.profile",
    order: 20,
    render: ctx => <ShipProfileTab ship={ctx.ship} />,
  },
  {
    value: "equipment",
    labelKey: "tabs.equipment",
    order: 30,
    render: ctx => <ShipEquipmentTab ship={ctx.ship} canManage={ctx.canManage} />,
  },
  {
    value: "maintenance",
    labelKey: "tabs.maintenance",
    order: 40,
    render: ctx => <ShipMaintenanceTab ship={ctx.ship} canManage={ctx.canManage} />,
  },
  {
    value: "projects",
    labelKey: "tabs.projects",
    order: 50,
    render: ctx => <ShipProjectsTab ship={ctx.ship} canManage={ctx.canManage} />,
  },
  {
    value: "files",
    labelKey: "tabs.files",
    order: 60,
    render: ctx => <ShipFilesTab ship={ctx.ship} />,
  },
];

/** Registry entries visible for the given context, sorted by `order`. */
export function visibleShipTabs(ctx: ShipTabContext): readonly ShipTabDefinition[] {
  return SHIP_TABS
    .filter(tab => tab.isVisible?.(ctx) ?? true)
    .toSorted((a, b) => a.order - b.order);
}
