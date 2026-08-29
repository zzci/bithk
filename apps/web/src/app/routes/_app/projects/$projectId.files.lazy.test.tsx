// Files tab LAYOUT: the drive surface has to take the height the detail layout
// has left over. It used to guess that height from the viewport minus a fixed
// 18rem, which left dead space or a second scrollbar whenever the guess missed —
// the detail header and the tab bar both vary per project (UI-032).

import type { ComponentType } from "react";
import type { ProjectView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectKeys } from "@/shared/lib/api/projects";
import { useAuthStore } from "@/shared/stores/auth";
import { makeTestQueryClient, renderWithProviders } from "@/test/utils";
import { Route } from "./$projectId.files.lazy";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
  useParams: () => ({ projectId: "p1" }),
  useNavigate: () => navigateMock,
  notFound: () => new Error("ROUTER_NOT_FOUND"),
}));

// The browser itself is out of scope here; the test is about the box around it.
vi.mock("../-file-browser", () => ({
  FileBrowser: () => <div data-testid="file-browser" />,
}));

const ProjectFilesRoute = (Route as unknown as { component: ComponentType }).component;

function project(): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas Refit",
    status: "active",
    description: null,
    sections: ["issues", "files"],
    tags: [],
    coverImageUrl: null,
    capabilities: ["files.view", "files.manage"],
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
  } as ProjectView;
}

function renderFilesTab() {
  const queryClient = makeTestQueryClient();
  queryClient.setQueryData(projectKeys.detail("p1"), project());
  return renderWithProviders(<ProjectFilesRoute />, { queryClient });
}

/** The element the route puts around <FileBrowser/>. */
function surface(): HTMLElement {
  const parent = screen.getByTestId("file-browser").parentElement;
  if (!parent)
    throw new Error("file browser has no container");
  return parent;
}

beforeEach(() => {
  navigateMock.mockReset();
  useAuthStore.setState({ user: null });
});

describe("project files tab sizing", () => {
  it("fills the leftover height of the tab area instead of a viewport guess", () => {
    renderFilesTab();

    const className = surface().className;
    // Flex fill: the detail layout hands down the remaining height, and min-h-0
    // lets the file list's own scroll area — not the page — absorb long folders.
    expect(className).toContain("flex-1");
    expect(className).toContain("min-h-0");
  });

  it("carries no viewport-derived height", () => {
    renderFilesTab();

    const className = surface().className;
    expect(className).not.toMatch(/calc\(100(?:s?vh|dvh)/);
    expect(className).not.toMatch(/\bh-\[/);
  });

  it("keeps cancelling the layout gutter so rows stay flush with the other tabs", () => {
    renderFilesTab();

    expect(surface().className).toContain("-mx-4");
  });
});
