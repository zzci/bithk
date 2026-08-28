// Sections settings panel, SUCCESS path: a mount / unmount that the API accepts
// has to land back on screen. The mutation only invalidates the project detail
// query, so anything reading `project.sections` — the panel's own switches and
// the detail tab set — must follow without a reload.
//
// The harness pairs the panel with the tab set the detail layout derives
// (`visibleProjectSections`, the same call `$projectId.lazy.tsx` makes) so the
// refresh is asserted end to end rather than on the switch alone.

import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectCapabilities } from "@/shared/hooks/use-project-capabilities";
import { useProject } from "@/shared/lib/api/projects";
import { renderWithProviders } from "@/test/utils";
import { visibleProjectSections } from "./-project-sections";
import { ProjectSettingsSections } from "./-project-settings-sections";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

function project(sections: readonly string[]): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas Refit",
    status: "active",
    description: null,
    sections,
    tags: [],
    coverImageUrl: null,
    capabilities: ["issue.view", "procurement.view", "files.view", "project.manage"],
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
  } as ProjectView;
}

/**
 * Server stub holding the project's mounted sections. PUT / DELETE on a section
 * route mutate it the way the API would, so a refetch observes the new state.
 */
function mockServer(initial: readonly string[]) {
  let sections = [...initial];
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = /\/sections\/([\w-]+)$/.exec(url)?.[1];
    if (key && method === "PUT") {
      sections = [...sections, key];
      return jsonResponse({ success: true, data: sections });
    }
    if (key && method === "DELETE") {
      sections = sections.filter(entry => entry !== key);
      return jsonResponse({ success: true, data: sections });
    }
    return jsonResponse({ success: true, data: project(sections) });
  });
}

// Panel plus the tab set the detail layout derives from the same project.
function SectionsHarness() {
  const projectQuery = useProject("p1");
  const caps = useProjectCapabilities(projectQuery.data);
  const project = projectQuery.data;
  if (!project)
    return null;
  return (
    <>
      <ProjectSettingsSections project={project} canManage />
      <ul aria-label="Tabs">
        {visibleProjectSections({ project, has: caps.has }).map(section => (
          <li key={section.key}>{section.key}</li>
        ))}
      </ul>
    </>
  );
}

/** Tab keys currently derived for the project. */
function tabKeys(): string[] {
  return [...screen.getByRole("list", { name: "Tabs" }).querySelectorAll("li")].map(li => li.textContent ?? "");
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("section mount / unmount success path", () => {
  it("adds the section's tab once the mount succeeds", async () => {
    const user = userEvent.setup();
    mockServer(["issues", "procurement", "files"]);
    renderWithProviders(<SectionsHarness />);

    await waitFor(() => expect(screen.getByRole("switch", { name: "Equipment" })).not.toBeChecked());
    expect(tabKeys()).toEqual(["overview", "issues", "procurement", "files"]);

    await user.click(screen.getByRole("switch", { name: "Equipment" }));

    // The panel refreshes from the invalidated detail query …
    await waitFor(() => expect(screen.getByRole("switch", { name: "Equipment" })).toBeChecked());
    // … and the tab set follows the new mount.
    expect(tabKeys()).toEqual(["overview", "issues", "procurement", "files", "equipment"]);
  });

  it("drops the section's tab once the unmount succeeds", async () => {
    const user = userEvent.setup();
    mockServer(["issues", "procurement", "files", "ship-profile", "equipment", "worklist"]);
    renderWithProviders(<SectionsHarness />);

    await waitFor(() => expect(screen.getByRole("switch", { name: "Checklists" })).toBeChecked());
    // Every ship tab is present up front, sub-projects included.
    expect(tabKeys()).toContain("worklist");
    expect(tabKeys()).toContain("sub-projects");

    await user.click(screen.getByRole("switch", { name: "Checklists" }));

    await waitFor(() => expect(screen.getByRole("switch", { name: "Checklists" })).not.toBeChecked());
    expect(tabKeys()).not.toContain("worklist");
    // Unmounting one section leaves the rest alone.
    expect(tabKeys()).toEqual(["overview", "issues", "procurement", "files", "ship-profile", "equipment", "sub-projects"]);
  });

  it("takes the sub-projects tab with the ship profile when it is unmounted", async () => {
    const user = userEvent.setup();
    mockServer(["issues", "ship-profile"]);
    renderWithProviders(<SectionsHarness />);

    await waitFor(() => expect(screen.getByRole("switch", { name: "Details" })).toBeChecked());
    expect(tabKeys()).toEqual(["overview", "issues", "ship-profile", "sub-projects"]);

    await user.click(screen.getByRole("switch", { name: "Details" }));

    // `sub-projects` is not a mountable section — its tab follows the ship
    // profile's mount, so it disappears with it.
    await waitFor(() => expect(tabKeys()).toEqual(["overview", "issues"]));
  });
});
