// HR section tab registry.
//
// HR sub-modules are first-class routes (one URL per tab) following the ship
// detail tab pattern (`ships/-ship-tabs.tsx`): the `/hr` layout sorts this
// registry by `order` to render the tab nav, and the pure `HR_TAB_TO` /
// `activeHrTab` helpers map between a tab key and its route — kept
// router-free so they are unit-testable without a router.
//
// Approvals and Payroll are pre-mounted placeholders: the tabs and routes
// exist so the HR information architecture is fixed, but the pages render an
// empty state until the sub-modules are implemented.

export interface HrTabDefinition {
  readonly value: HrTab;
  readonly labelKey: string;
  readonly order: number;
}

export type HrTab = "colleagues" | "approvals" | "payroll";

export const HR_TABS: readonly HrTabDefinition[] = [
  { value: "colleagues", labelKey: "tabs.colleagues", order: 10 },
  { value: "approvals", labelKey: "tabs.approvals", order: 20 },
  { value: "payroll", labelKey: "tabs.payroll", order: 30 },
];

/** Registry entries sorted by `order`. */
export function hrTabs(): readonly HrTabDefinition[] {
  return HR_TABS.toSorted((a, b) => a.order - b.order);
}

// TanStack `to` templates for each tab.
export const HR_TAB_TO: Record<HrTab, string> = {
  colleagues: "/hr/colleagues",
  approvals: "/hr/approvals",
  payroll: "/hr/payroll",
};

/**
 * Resolve the active tab from a pathname. Unknown / index paths fall back to
 * `colleagues` (the HR landing tab).
 */
export function activeHrTab(pathname: string): HrTab {
  const rest = pathname.startsWith("/hr") ? pathname.slice("/hr".length) : "";
  const segment = rest.split("/").filter(Boolean)[0];
  if (segment === "approvals")
    return "approvals";
  if (segment === "payroll")
    return "payroll";
  return "colleagues";
}
