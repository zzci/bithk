import type { ShipView } from "@/shared/lib/api/ships";
import { describe, expect, it } from "vitest";
import { SHIP_TABS, visibleShipTabs } from "./-ship-tabs";

const ship = { id: "s1", name: "Serenity", baseProjectId: "p1" } as ShipView;

describe("ship tab registry", () => {
  it("exposes Overview, Projects and Files in ascending order", () => {
    const tabs = visibleShipTabs({ ship, canManage: true });
    expect(tabs.map(t => t.value)).toEqual(["overview", "projects", "files"]);
    expect(tabs.map(t => t.order)).toEqual([...tabs.map(t => t.order)].sort((a, b) => a - b));
  });

  it("leaves order gaps (20/30) free for T5b equipment/maintenance tabs", () => {
    const used = new Set(SHIP_TABS.map(t => t.order));
    expect(used.has(20)).toBe(false);
    expect(used.has(30)).toBe(false);
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
