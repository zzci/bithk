import type { ShipView } from "@/shared/lib/api/ships";
import { describe, expect, it } from "vitest";
import { activeShipTab, SHIP_TAB_TO, SHIP_TABS, visibleShipTabs } from "./-ship-tabs";

const ship = { id: "s1", name: "Serenity", baseProjectId: "p1" } as ShipView;
const SID = "s1";

describe("ship tab registry", () => {
  it("exposes ship detail tabs in ascending order", () => {
    const tabs = visibleShipTabs({ ship, canManage: true });
    expect(tabs.map(t => t.value)).toEqual(["overview", "profile", "equipment", "worklist", "projects", "files"]);
    expect(tabs.map(t => t.order)).toEqual([...tabs.map(t => t.order)].sort((a, b) => a - b));
  });

  it("registers every reserved order slot", () => {
    const used = new Set(SHIP_TABS.map(t => t.order));
    for (const slot of [10, 20, 30, 40, 50, 60])
      expect(used.has(slot)).toBe(true);
  });

  it("maps each tab to a ships-namespace label key", () => {
    for (const tab of SHIP_TABS)
      expect(tab.labelKey.startsWith("tabs.")).toBe(true);
  });
});

describe("sHIP_TAB_TO", () => {
  it("maps every tab to its route template, overview to the ship index", () => {
    expect(SHIP_TAB_TO.overview).toBe("/ships/$shipId");
    expect(SHIP_TAB_TO.profile).toBe("/ships/$shipId/profile");
    expect(SHIP_TAB_TO.equipment).toBe("/ships/$shipId/equipment");
    expect(SHIP_TAB_TO.worklist).toBe("/ships/$shipId/worklist");
    expect(SHIP_TAB_TO.projects).toBe("/ships/$shipId/projects");
    expect(SHIP_TAB_TO.files).toBe("/ships/$shipId/files");
  });
});

describe("activeShipTab", () => {
  it("resolves the index path to overview", () => {
    expect(activeShipTab(`/ships/${SID}`, SID)).toBe("overview");
    expect(activeShipTab(`/ships/${SID}/`, SID)).toBe("overview");
  });

  it("resolves each tab segment", () => {
    expect(activeShipTab(`/ships/${SID}/profile`, SID)).toBe("profile");
    expect(activeShipTab(`/ships/${SID}/equipment`, SID)).toBe("equipment");
    expect(activeShipTab(`/ships/${SID}/worklist`, SID)).toBe("worklist");
    expect(activeShipTab(`/ships/${SID}/projects`, SID)).toBe("projects");
    expect(activeShipTab(`/ships/${SID}/files`, SID)).toBe("files");
  });

  it("falls back to overview for unknown segments or foreign paths", () => {
    expect(activeShipTab(`/ships/${SID}/bogus`, SID)).toBe("overview");
    expect(activeShipTab(`/projects/${SID}/equipment`, SID)).toBe("overview");
  });
});
