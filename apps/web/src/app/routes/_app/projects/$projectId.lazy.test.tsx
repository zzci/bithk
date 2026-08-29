import type { ComponentType } from "react";
import type { ProjectView } from "@/shared/lib/api/projects";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { Route } from "./$projectId.lazy";

// Stub the router so the lazy route file imports and exposes its component
// directly (`createLazyFileRoute(id)(opts)` returns `opts`), and the layout's
// router hooks resolve to fixed values without a real router tree.
const navigateMock = vi.fn();
const mockParams: { current: Record<string, string> } = { current: { projectId: "p1" } };
const mockPathname = { current: "/projects/p1" };
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
  useNavigate: () => navigateMock,
  useParams: () => mockParams.current,
  useSearch: () => ({ settings: false }),
  useLocation: () => ({ pathname: mockPathname.current }),
  Outlet: () => null,
}));

const ProjectDetailLayout = (Route as unknown as { component: ComponentType }).component;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function listResponse(total: number) {
  return jsonResponse({ success: true, data: [], meta: { total, page: 1, limit: 1 } });
}

const fetchMock = vi.fn<typeof fetch>();

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas Refit",
    status: "active",
    description: null,
    sections: ["issues", "procurement", "files"],
    tags: [],
    coverImageUrl: null,
    capabilities: ["issue.view"],
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

// Routes every query the layout fires. Order matters: the more specific
// member/issue paths are matched before the bare project-detail path.
function mockRoutes(opts: { detail?: () => Response; issuesTotal?: number } = {}) {
  const { detail, issuesTotal = 3 } = opts;
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/account/visible-users"))
      return jsonResponse({ success: true, data: [] });
    if (url.includes("/favorites"))
      return jsonResponse({ success: true, data: [] });
    if (url.includes("/members"))
      return jsonResponse({ success: true, data: [] });
    if (url.includes("/issues"))
      return listResponse(issuesTotal);
    if (url.includes("/procurements"))
      return listResponse(0);
    return detail ? detail() : jsonResponse({ success: true, data: project() });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  mockParams.current = { projectId: "p1" };
  mockPathname.current = "/projects/p1";
  globalThis.fetch = fetchMock;
  // Not an app admin, so capability gating comes purely from the payload.
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  fetchMock.mockReset();
});

/** Rendered tab labels, in order, with the trailing count suffix stripped. */
function tabNames(): string[] {
  return screen.getAllByRole("tab").map(tab => (tab.textContent ?? "").replace(/\s*\d+$/, "").trim());
}

describe("projectDetailLayout tab gating", () => {
  it("shows only the tabs the caller's capabilities allow", async () => {
    mockRoutes();
    renderWithProviders(<ProjectDetailLayout />);

    // Overview is always present; issues is gated by `issue.view`.
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Work Orders/ })).toBeInTheDocument();
    // No procurement / files capability → those tabs are hidden.
    expect(screen.queryByRole("tab", { name: /Procurement/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Files/ })).not.toBeInTheDocument();
    // No management capability → the settings affordance is hidden.
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("hides a section tab the project has not mounted, even with the capability", async () => {
    // `files.view` is held but the `files` section is absent: the tab is gone.
    mockRoutes({
      detail: () => jsonResponse({
        success: true,
        data: project({ sections: ["issues"], capabilities: ["issue.view", "files.view"] }),
      }),
    });
    renderWithProviders(<ProjectDetailLayout />);

    expect(await screen.findByRole("tab", { name: /Work Orders/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Files/ })).not.toBeInTheDocument();
  });

  it("renders the ship-preset tabs for a project that mounts those sections", async () => {
    mockRoutes({
      detail: () => jsonResponse({
        success: true,
        data: project({
          sections: ["issues", "procurement", "files", "ship-profile", "equipment", "worklist"],
          capabilities: ["issue.view"],
        }),
      }),
    });
    renderWithProviders(<ProjectDetailLayout />);

    expect(await screen.findByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Equipment" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Checklists" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sub-projects" })).toBeInTheDocument();
  });

  it("gives a general project its four section tabs plus sub-projects", async () => {
    mockRoutes({
      detail: () => jsonResponse({
        success: true,
        data: project({
          sections: ["issues", "procurement", "files"],
          capabilities: ["issue.view", "procurement.view", "files.view"],
        }),
      }),
    });
    renderWithProviders(<ProjectDetailLayout />);

    await screen.findByRole("tab", { name: "Overview" });
    // Sub-projects is core, so it is here without a single ship section mounted.
    expect(tabNames()).toEqual(["Overview", "Work Orders", "Procurement", "Files", "Sub-projects"]);
    // No maritime section mounted, so none of the ship-preset tabs appear.
    for (const absent of ["Details", "Equipment", "Checklists"])
      expect(screen.queryByRole("tab", { name: absent })).not.toBeInTheDocument();
  });

  it("gives a ship project all eight tabs in registry order", async () => {
    mockRoutes({
      detail: () => jsonResponse({
        success: true,
        data: project({
          sections: ["issues", "procurement", "files", "ship-profile", "equipment", "worklist"],
          capabilities: ["issue.view", "procurement.view", "files.view"],
        }),
      }),
    });
    renderWithProviders(<ProjectDetailLayout />);

    await screen.findByRole("tab", { name: "Overview" });
    expect(tabNames()).toEqual([
      "Overview",
      "Work Orders",
      "Procurement",
      "Files",
      "Details",
      "Equipment",
      "Checklists",
      "Sub-projects",
    ]);
  });

  it("back button returns to the project list", async () => {
    mockRoutes();
    renderWithProviders(<ProjectDetailLayout />);

    const back = await screen.findByRole("button", { name: "Back to projects" });
    fireEvent.click(back);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/projects" });
  });

  it("keeps the flow shell for a tab that scrolls with the page (UI-032)", async () => {
    // Every tab but files sizes the page from its own content, so its shell
    // must stay the plain block box it has always been — a viewport-height
    // flex column here would push the layout's bottom padding out of the
    // scrollable area and clip margins that used to collapse through.
    mockRoutes();
    const { container } = renderWithProviders(<ProjectDetailLayout />);

    await screen.findByRole("tab", { name: "Overview" });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("space-y-5");
    expect((root.lastElementChild as HTMLElement).className).toBe("pt-1");
  });

  it("gives the files tab body the leftover height of the page (UI-032)", async () => {
    // The files tab owns its own scroll area, so the shell becomes a flex
    // column with a definite height and the body claims what is left of it
    // (`flex-1 min-h-0` in the route) rather than subtracting a guessed header
    // height from the viewport.
    mockPathname.current = "/projects/p1/files";
    mockRoutes({
      detail: () => jsonResponse({
        success: true,
        data: project({ capabilities: ["issue.view", "files.view"] }),
      }),
    });
    const { container } = renderWithProviders(<ProjectDetailLayout />);

    await screen.findByRole("tab", { name: "Files" });
    const root = container.firstElementChild as HTMLElement;
    for (const cls of ["flex", "flex-col", "flex-1", "min-h-0"])
      expect(root.className).toContain(cls);

    const outletHost = root.lastElementChild as HTMLElement;
    for (const cls of ["flex", "flex-col", "flex-1", "min-h-0", "pt-1"])
      expect(outletHost.className).toContain(cls);
  });

  it("renders the not-found branch when the project query errors", async () => {
    // The project-detail responder returns 404 so the project query rejects.
    mockRoutes({ detail: () => new Response(JSON.stringify({ success: false }), { status: 404, headers: { "Content-Type": "application/json" } }) });

    renderWithProviders(<ProjectDetailLayout />);

    expect(await screen.findByText("Project not found or you do not have access.")).toBeInTheDocument();
  });
});
