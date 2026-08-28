import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS } from "./-project-sections";
import { activeProjectTab, PROJECT_TAB_TO, PROJECT_TABS } from "./-project-tabs";

const PID = "p1";

describe("activeProjectTab", () => {
  it("resolves the index path to overview", () => {
    expect(activeProjectTab(`/projects/${PID}`, PID)).toBe("overview");
    expect(activeProjectTab(`/projects/${PID}/`, PID)).toBe("overview");
  });

  it("resolves each tab segment", () => {
    expect(activeProjectTab(`/projects/${PID}/issues`, PID)).toBe("issues");
    expect(activeProjectTab(`/projects/${PID}/procurements`, PID)).toBe("procurement");
    expect(activeProjectTab(`/projects/${PID}/files`, PID)).toBe("files");
    expect(activeProjectTab(`/projects/${PID}/profile`, PID)).toBe("ship-profile");
    expect(activeProjectTab(`/projects/${PID}/equipment`, PID)).toBe("equipment");
    expect(activeProjectTab(`/projects/${PID}/worklist`, PID)).toBe("worklist");
    expect(activeProjectTab(`/projects/${PID}/sub-projects`, PID)).toBe("sub-projects");
  });

  it("keeps the owning tab while a nested detail route overlays the list", () => {
    expect(activeProjectTab(`/projects/${PID}/issues/i9`, PID)).toBe("issues");
    expect(activeProjectTab(`/projects/${PID}/procurements/pr9`, PID)).toBe("procurement");
  });

  it("keeps the owning tab for the full-page detail breakout routes", () => {
    // `$projectId_.issues.$issueId.full` escapes the layout, but the pathname
    // still starts with the project's own segments.
    expect(activeProjectTab(`/projects/${PID}/issues/i9/full`, PID)).toBe("issues");
    expect(activeProjectTab(`/projects/${PID}/procurements/pr9/full`, PID)).toBe("procurement");
  });

  it("resolves every registry segment from an arbitrarily nested path", () => {
    // Registry-driven, so a section added later is covered without editing
    // this test: only its `routeSegment` has to be declared.
    for (const section of PROJECT_SECTIONS.filter(entry => entry.routeSegment !== ""))
      expect(activeProjectTab(`/projects/${PID}/${section.routeSegment}/x/y`, PID)).toBe(section.key);
  });

  it("falls back to overview for unknown segments or foreign paths", () => {
    expect(activeProjectTab(`/projects/${PID}/bogus`, PID)).toBe("overview");
    expect(activeProjectTab(`/documents/${PID}/issues`, PID)).toBe("overview");
  });
});

describe("pROJECT_TAB_TO", () => {
  it("maps every tab to its route template, procurement plural to match the drawer", () => {
    expect(PROJECT_TAB_TO.overview).toBe("/projects/$projectId");
    expect(PROJECT_TAB_TO.issues).toBe("/projects/$projectId/issues");
    expect(PROJECT_TAB_TO.procurement).toBe("/projects/$projectId/procurements");
    expect(PROJECT_TAB_TO.files).toBe("/projects/$projectId/files");
    expect(PROJECT_TAB_TO["ship-profile"]).toBe("/projects/$projectId/profile");
    expect(PROJECT_TAB_TO.equipment).toBe("/projects/$projectId/equipment");
    expect(PROJECT_TAB_TO.worklist).toBe("/projects/$projectId/worklist");
    expect(PROJECT_TAB_TO["sub-projects"]).toBe("/projects/$projectId/sub-projects");
  });

  it("covers every registry entry exactly once, in `order`", () => {
    expect(PROJECT_TABS).toEqual([
      "overview",
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
      "sub-projects",
    ]);
    expect(Object.keys(PROJECT_TAB_TO).toSorted()).toEqual([...PROJECT_SECTIONS.map(s => s.key)].toSorted());
  });
});
