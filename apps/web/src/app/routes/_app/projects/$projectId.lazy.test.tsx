import type { ComponentType } from "react";
import type { ProjectView } from "@/shared/lib/api/projects";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { Route } from "./$projectId.lazy";

// Stub the router so the lazy route file imports and exposes its component
// directly (`createLazyFileRoute(id)(opts)` returns `opts`), and the layout's
// router hooks resolve to fixed values without a real router tree. `mockParams`
// is mutable so a test can simulate the `from/$shipId` entry (ship segment
// present) vs. the plain project route.
const navigateMock = vi.fn();
const mockParams: { current: Record<string, string> } = { current: { projectId: "p1" } };
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
  useNavigate: () => navigateMock,
  useParams: () => mockParams.current,
  useSearch: () => ({ settings: false }),
  useLocation: () => ({ pathname: "/projects/p1" }),
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
  globalThis.fetch = fetchMock;
  // Not an app admin, so capability gating comes purely from the payload.
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  fetchMock.mockReset();
});

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

  it("back button returns to the project list when not opened from a ship", async () => {
    mockRoutes();
    renderWithProviders(<ProjectDetailLayout />);

    const back = await screen.findByRole("button", { name: "Back to projects" });
    fireEvent.click(back);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/projects" });
  });

  it("back button returns to the originating ship when opened from one", async () => {
    // The `from/$shipId` route supplies the ship segment via useParams.
    mockParams.current = { projectId: "p1", shipId: "s1" };
    mockRoutes();
    renderWithProviders(<ProjectDetailLayout />);

    const back = await screen.findByRole("button", { name: "Back to ship" });
    fireEvent.click(back);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/ships/$shipId", params: { shipId: "s1" } });
  });

  it("renders the not-found branch when the project query errors", async () => {
    // The project-detail responder returns 404 so the project query rejects.
    mockRoutes({ detail: () => new Response(JSON.stringify({ success: false }), { status: 404, headers: { "Content-Type": "application/json" } }) });

    renderWithProviders(<ProjectDetailLayout />);

    expect(await screen.findByText("Project not found or you do not have access.")).toBeInTheDocument();
  });
});
