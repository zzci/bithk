import type { ProjectSectionContext } from "./-project-sections";
import { describe, expect, it } from "vitest";
import { PROJECT_CAPABILITIES, PROJECT_PRESETS, PROJECT_SECTION_KEYS } from "@/shared/lib/api/projects";
import {
  CAPABILITY_SECTION,
  getProjectSection,
  isCapabilityOffered,
  isProjectSectionKey,
  isProjectSectionVisible,
  mountableProjectSections,
  PROJECT_CORE_SECTION,
  PROJECT_SECTIONS,
  projectSectionFilterLabelKey,
  projectSectionLabelKey,
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
  it("shows a general project overview, its three mounted sections and sub-projects", () => {
    // Sub-projects is core: a general project reaches it exactly like a ship.
    const visible = visibleProjectSections(ctx(PROJECT_PRESETS.general)).map(s => s.key);
    expect(visible).toEqual(["overview", "issues", "procurement", "files", "sub-projects"]);
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
    expect(visible).toEqual(["overview", "issues", "sub-projects"]);
  });

  it("keeps the two core tabs visible even with nothing mounted", () => {
    expect(visibleProjectSections(ctx([])).map(s => s.key)).toEqual(["overview", "sub-projects"]);
  });
});

describe("isProjectSectionVisible", () => {
  it("gates each ship tab on its own mount", () => {
    expect(isProjectSectionVisible("equipment", ctx(["equipment"]))).toBe(true);
    expect(isProjectSectionVisible("equipment", ctx(["worklist"]))).toBe(false);
  });

  it("gates neither core tab on a mount", () => {
    // `parent_id` is core and the API serves `/children` for every project, so
    // the sub-projects tab is reachable whatever the project mounts.
    for (const sections of [PROJECT_PRESETS.ship, PROJECT_PRESETS.general, []]) {
      expect(isProjectSectionVisible("sub-projects", ctx(sections))).toBe(true);
      expect(isProjectSectionVisible("overview", ctx(sections))).toBe(true);
    }
  });
});

describe("getProjectSection", () => {
  it("resolves a known key and returns undefined for anything else", () => {
    expect(getProjectSection("worklist")?.routeSegment).toBe("worklist");
    expect(getProjectSection("nope")).toBeUndefined();
  });
});

describe("mountableProjectSections", () => {
  it("keeps only the API's mount keys, in tab order", () => {
    const keys = mountableProjectSections().map(s => s.key);
    expect(keys).toEqual(["issues", "procurement", "files", "ship-profile", "equipment", "worklist"]);
    // The two non-sections never leak into a mount / filter / settings list.
    expect(keys).not.toContain("overview");
    expect(keys).not.toContain("sub-projects");
  });

  it("recognises exactly the API section keys", () => {
    for (const key of PROJECT_SECTION_KEYS)
      expect(isProjectSectionKey(key)).toBe(true);
    expect(isProjectSectionKey("overview")).toBe(false);
    expect(isProjectSectionKey("sub-projects")).toBe(false);
  });
});

describe("section label keys", () => {
  it("namespaces the tab label", () => {
    expect(projectSectionLabelKey(getProjectSection("equipment")!)).toBe("ships:tabs.equipment");
  });

  it("keeps the core tabs out of the ships namespace", () => {
    // A tab every project shows must not depend on `ships.json` being loaded.
    expect(projectSectionLabelKey(getProjectSection("overview")!)).toBe("projects:tabs.overview");
    expect(projectSectionLabelKey(getProjectSection("sub-projects")!)).toBe("projects:tabs.subProjects");
  });

  it("prefers the filter override where the tab label would not read as a chip", () => {
    // The ship-profile TAB is "Details"; the list FILTER chip is "Ships".
    expect(projectSectionFilterLabelKey(getProjectSection("ship-profile")!)).toBe("ships:list.filterLabel");
    // Every other entry falls back to its tab label.
    expect(projectSectionFilterLabelKey(getProjectSection("worklist")!)).toBe("ships:tabs.worklist");
  });
});

describe("overview tile contributions", () => {
  it("gives every mountable section a tile and neither non-section one", () => {
    for (const section of mountableProjectSections())
      expect(section.tile).toBeDefined();
    expect(getProjectSection("overview")?.tile).toBeUndefined();
    expect(getProjectSection("sub-projects")?.tile).toBeUndefined();
  });

  it("yields a general project three tiles and a ship project six", () => {
    const tiles = (sections: readonly string[]) =>
      visibleProjectSections(ctx(sections)).filter(s => s.tile).map(s => s.key);
    expect(tiles(PROJECT_PRESETS.general)).toEqual(["issues", "procurement", "files"]);
    expect(tiles(PROJECT_PRESETS.ship)).toEqual([
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
    ]);
  });
});

describe("cAPABILITY_SECTION", () => {
  it("tags every capability the frontend knows about", () => {
    for (const capability of PROJECT_CAPABILITIES)
      expect(CAPABILITY_SECTION[capability]).toBeDefined();
    expect(Object.keys(CAPABILITY_SECTION)).toHaveLength(PROJECT_CAPABILITIES.length);
  });

  it("points every non-core capability at a real section key", () => {
    for (const [capability, section] of Object.entries(CAPABILITY_SECTION)) {
      if (section !== PROJECT_CORE_SECTION)
        expect(isProjectSectionKey(section)).toBe(true);
      else
        expect(["members.manage", "roles.manage", "project.manage"]).toContain(capability);
    }
  });

  it("files procurement categories under procurement, not core", () => {
    expect(CAPABILITY_SECTION["categories.manage"]).toBe("procurement");
  });
});

describe("isCapabilityOffered", () => {
  it("always offers the core capabilities", () => {
    for (const capability of ["members.manage", "roles.manage", "project.manage"] as const)
      expect(isCapabilityOffered(capability, [])).toBe(true);
  });

  it("offers a section's capabilities only while that section is mounted", () => {
    expect(isCapabilityOffered("issue.view", ["issues"])).toBe(true);
    expect(isCapabilityOffered("issue.view", ["files"])).toBe(false);
    // Procurement categories follow procurement's mount, not files'.
    expect(isCapabilityOffered("categories.manage", ["procurement"])).toBe(true);
    expect(isCapabilityOffered("categories.manage", ["files"])).toBe(false);
  });
});
