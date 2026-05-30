import { describe, expect, it } from "vitest";
import { activeProjectTab, PROJECT_TAB_TO } from "./-project-tabs";

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
  });

  it("keeps the owning tab while a nested detail route overlays the list", () => {
    expect(activeProjectTab(`/projects/${PID}/issues/i9`, PID)).toBe("issues");
    expect(activeProjectTab(`/projects/${PID}/procurements/pr9`, PID)).toBe("procurement");
  });

  it("falls back to overview for unknown segments or foreign paths", () => {
    expect(activeProjectTab(`/projects/${PID}/bogus`, PID)).toBe("overview");
    expect(activeProjectTab(`/ships/${PID}/issues`, PID)).toBe("overview");
  });
});

describe("pROJECT_TAB_TO", () => {
  it("maps every tab to its route template, procurement plural to match the drawer", () => {
    expect(PROJECT_TAB_TO.overview).toBe("/projects/$projectId");
    expect(PROJECT_TAB_TO.issues).toBe("/projects/$projectId/issues");
    expect(PROJECT_TAB_TO.procurement).toBe("/projects/$projectId/procurements");
    expect(PROJECT_TAB_TO.files).toBe("/projects/$projectId/files");
  });
});
