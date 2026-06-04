import type { ComponentType } from "react";
import type { ShipView } from "@/shared/lib/api/ships";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { Route } from "./$shipId.lazy";

// Stub the router so the lazy route file exposes its component directly
// (`createLazyFileRoute(id)(opts)` returns `opts`) and the layout's router hooks
// resolve to fixed values without a real router tree. `mockPathname` is mutable
// so a test can drive the active tab from the URL the layout reads.
const navigateMock = vi.fn();
const mockPathname = { current: "/ships/s1/equipment" };
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
  useNavigate: () => navigateMock,
  useParams: () => ({ shipId: "s1" }),
  useLocation: () => ({ pathname: mockPathname.current }),
  Outlet: () => null,
}));

const ShipDetailLayout = (Route as unknown as { component: ComponentType }).component;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return {
    id: "s1",
    code: "HULL-1",
    name: "Serenity",
    status: "active",
    tags: [],
    baseProjectId: "p1",
    model: null,
    builder: null,
    buildYear: null,
    lengthOverall: null,
    beam: null,
    draft: null,
    airDraft: null,
    grossTonnage: null,
    imoNumber: null,
    mmsi: null,
    callSign: null,
    flagState: null,
    registryPort: null,
    ownerName: null,
    description: null,
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

// Routes every query the layout fires. Order matters: the nested ship sub-paths
// are matched before the bare `/ships/s1` detail path.
function mockRoutes() {
  fetchMock.mockImplementation(async (input) => {
    const path = String(input).replace("/api", "");
    if (path.startsWith("/ships/s1/projects"))
      return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/ships/s1/equipment"))
      return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/ships/s1/worklists"))
      return jsonResponse({ success: true, data: [] });
    if (path.startsWith("/ships/s1"))
      return jsonResponse({ success: true, data: ship() });
    if (path.startsWith("/projects/p1"))
      return jsonResponse({ success: true, data: { id: "p1", code: "PRJ-1", name: "Base", status: "active", description: null, tags: [], coverImageUrl: null, capabilities: [], creatorId: "u1", version: 1, updatedAt: "2026-05-24T00:00:00.000Z" } });
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  mockPathname.current = "/ships/s1/equipment";
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("shipDetailLayout tab nav", () => {
  it("derives the active tab from the URL pathname", async () => {
    mockRoutes();
    renderWithProviders(<ShipDetailLayout />);

    // All six registry tabs render in the nav.
    expect(await screen.findByRole("tab", { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Profile/ })).toBeInTheDocument();
    const equipment = screen.getByRole("tab", { name: /Equipment/ });
    expect(screen.getByRole("tab", { name: /Worklist/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Projects/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Files/ })).toBeInTheDocument();

    // Pathname `/ships/s1/equipment` → the equipment trigger is the active one.
    expect(equipment).toHaveAttribute("data-active");
    expect(screen.getByRole("tab", { name: /Overview/ })).not.toHaveAttribute("data-active");
  });
});
