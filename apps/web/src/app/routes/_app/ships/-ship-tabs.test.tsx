import type { ShipView } from "@/shared/lib/api/ships";
import { describe, expect, it } from "vitest";
import { SHIP_TABS, visibleShipTabs } from "./-ship-tabs";

const ship = { id: "s1", name: "Serenity", baseProjectId: "p1" } as ShipView;

describe("ship tab registry", () => {
  it("exposes ship detail tabs in ascending order", () => {
    const tabs = visibleShipTabs({ ship, canManage: true });
    expect(tabs.map(t => t.value)).toEqual(["overview", "equipment", "maintenance", "projects", "files"]);
    expect(tabs.map(t => t.order)).toEqual([...tabs.map(t => t.order)].sort((a, b) => a - b));
  });

  it("registers T5b equipment and maintenance slots", () => {
    const used = new Set(SHIP_TABS.map(t => t.order));
    expect(used.has(20)).toBe(true);
    expect(used.has(30)).toBe(true);
  });

  it("maps each tab to a ships-namespace label key", () => {
    for (const tab of SHIP_TABS)
      expect(tab.labelKey.startsWith("tabs.")).toBe(true);
  });

  it("renders a node for every tab", () => {
    for (const tab of visibleShipTabs({ ship, canManage: false }))
      expect(tab.render({ ship, canManage: false })).toBeTruthy();
  });
});
