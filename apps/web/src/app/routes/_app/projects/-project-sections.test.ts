import type { ProjectSectionContext } from "./-project-sections";
import { describe, expect, it } from "vitest";
import { PROJECT_PRESETS, PROJECT_SECTION_KEYS } from "@/shared/lib/api/projects";
import {
  getProjectSection,
  isProjectSectionVisible,
  PROJECT_SECTIONS,
  sortedProjectSections,
  visibleProjectSections,
} from "./-project-sections";

/** Context helper: a project with `sections` mounted, and full capabilities. */
function ctx(sections: readonly string[], held: readonly string[] = ["issue.view", "procurement.view", "files.view"]): ProjectSectionContext {
  return { project: { sections }, has: cap => held.includes(cap) };
}

describe("pROJECT_SECTIONS", () => {
  it("mirrors the API section keys plus the two core tabs", () => {
    const keys = PROJECT_SECTIONS.map(s => s.key);
    for (const apiKey of PROJECT_SECTION_KEYS)
      expect(keys).toContain(apiKey);
    // Not sections: the index route and the sub-project hierarchy.
    expect(keys).toContain("overview");
    expect(keys).toContain("sub-projects");
    expect(keys).toHaveLength(PROJECT_SECTION_KEYS.length + 2);
  });

  it("gives every entry a unique key, order and route segment", () => {
    const keys = PROJECT_SECTIONS.map(s => s.key);
    const orders = PROJECT_SECTIONS.map(s => s.order);
    const segments = PROJECT_SECTIONS.map(s => s.routeSegment);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it("sorts by order", () => {
    const orders = sortedProjectSections().map(s => s.order);
    expect(orders).toEqual([...orders].toSorted((a, b) => a - b));
  });
});

describe("visibleProjectSections", () => {
  it("shows a general project only overview plus its three mounted sections", () => {
    const visible = visibleProjectSections(ctx(PROJECT_PRESETS.general)).map(s => s.key);
    expect(visible).toEqual(["overview", "issues", "procurement", "files"]);
  });

  it("shows a ship project every tab", () => {
    const visible = visibleProjectSections(ctx(PROJECT_PRESETS.ship)).map(s => s.key);
    expect(visible).toEqual([
      "overview",
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
      "sub-projects",
    ]);
  });

  it("hides a mounted section whose view capability the caller lacks", () => {
    const visible = visibleProjectSections(ctx(PROJECT_PRESETS.general, ["issue.view"])).map(s => s.key);
    expect(visible).toEqual(["overview", "issues"]);
  });

  it("keeps overview visible even with nothing mounted", () => {
    expect(visibleProjectSections(ctx([])).map(s => s.key)).toEqual(["overview"]);
  });
});

describe("isProjectSectionVisible", () => {
  it("gates each ship tab on its own mount", () => {
    expect(isProjectSectionVisible("equipment", ctx(["equipment"]))).toBe(true);
    expect(isProjectSectionVisible("equipment", ctx(["worklist"]))).toBe(false);
  });

  it("gates the sub-projects tab on the ship preset", () => {
    expect(isProjectSectionVisible("sub-projects", ctx(PROJECT_PRESETS.ship))).toBe(true);
    expect(isProjectSectionVisible("sub-projects", ctx(PROJECT_PRESETS.general))).toBe(false);
  });
});

describe("getProjectSection", () => {
  it("resolves a known key and returns undefined for anything else", () => {
    expect(getProjectSection("worklist")?.routeSegment).toBe("worklist");
    expect(getProjectSection("nope")).toBeUndefined();
  });
});
