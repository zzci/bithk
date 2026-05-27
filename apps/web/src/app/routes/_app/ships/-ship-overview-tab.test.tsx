import type { ShipView } from "@/shared/lib/api/ships";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipOverviewTab } from "./-ship-overview-tab";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

// The overview tab loads projects/equipment/templates/orders for its right-hand
// previews; route these so the dashboard cards render real, deterministic data.
function routeFetch() {
  fetchMock.mockImplementation(async (input) => {
    const path = String(input).replace("/api", "");
    if (path === "/ships/s1/projects")
      return jsonResponse({ success: true, data: [{ id: "p1", name: "Base ops", code: "OPS", isBase: true, status: "active" }] });
    if (path === "/ships/s1/equipment")
      return jsonResponse({ success: true, data: [{ id: "eq1", name: "Generator", category: "Power", status: "active" }] });
    if (path === "/ships/s1/maintenance-templates")
      return jsonResponse({ success: true, data: [{ id: "tpl1", name: "Quarterly" }] });
    if (path === "/ships/s1/maintenance-orders")
      return jsonResponse({ success: true, data: [{ id: "wo1", title: "Hull survey", status: "open", projectId: "p1", templateRefId: "tpl1", referenceId: "r1" }] });
    return new Response("not found", { status: 404 });
  });
}

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return {
    id: "s1",
    code: "HULL-1",
    name: "Serenity",
    status: "active",
    lifecycleStage: "building",
    baseProjectId: "p1",
    model: null,
    builder: "Acme Yards",
    buildYear: 2024,
    lengthOverall: null,
    beam: null,
    draft: null,
    grossTonnage: null,
    imoNumber: null,
    mmsi: null,
    callSign: null,
    flagState: null,
    registryPort: null,
    ownerName: null,
    description: "Flagship build",
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("shipOverviewTab", () => {
  it("renders the lifecycle stage, basic info and placeholders for unset fields", () => {
    routeFetch();
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage={false} />);
    expect(screen.getByText("Flagship build")).toBeInTheDocument();
    // Lifecycle "Building" appears both in the archive field and the stepper.
    expect(screen.getAllByText("Building").length).toBeGreaterThan(0);
    expect(screen.getByText("HULL-1")).toBeInTheDocument();
    expect(screen.getByText("Acme Yards")).toBeInTheDocument();
    // model + several maritime fields are null → "Not set" placeholder.
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("hides the edit affordance when the caller cannot manage", () => {
    routeFetch();
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows the edit affordance when the caller can manage", () => {
    routeFetch();
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("previews bound projects, equipment categories and active maintenance", async () => {
    routeFetch();
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Base ops")).toBeInTheDocument());
    expect(screen.getByText("Power")).toBeInTheDocument();
    expect(screen.getByText("Hull survey")).toBeInTheDocument();
  });
});
