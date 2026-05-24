import type { ShipProjectView, ShipView } from "@/shared/lib/api/ships";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipProjectsTab } from "./-ship-projects-tab";

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

const ship = { id: "s1", name: "Serenity", baseProjectId: "p1" } as ShipView;

function projectsPayload(): readonly ShipProjectView[] {
  return [
    { id: "p1", name: "Base ops", code: "OPS", isBase: true } as ShipProjectView,
    { id: "p2", name: "Refit 2026", code: "RF", isBase: false } as ShipProjectView,
  ];
}

describe("shipProjectsTab", () => {
  it("renders the base project with a Base badge and no unbind action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: projectsPayload() }));
    renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Base ops")).toBeInTheDocument());
    expect(screen.getByText("Base")).toBeInTheDocument();
    // Exactly one unbind button — the base project is not unbindable.
    expect(screen.getAllByRole("button", { name: "Unbind" })).toHaveLength(1);
  });

  it("shows the bind input for managers and hides it otherwise", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: projectsPayload() }));
    const { rerender } = renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Project ID")).toBeInTheDocument();

    rerender(<ShipProjectsTab ship={ship} canManage={false} />);
    expect(screen.queryByPlaceholderText("Project ID")).not.toBeInTheDocument();
    // Non-managers see no unbind actions at all.
    expect(screen.queryByRole("button", { name: "Unbind" })).not.toBeInTheDocument();
  });

  it("binds a project id through POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: projectsPayload() }));
    renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Project ID"), "p9");
    await userEvent.click(screen.getByRole("button", { name: "Bind" }));

    await waitFor(() => {
      const bindCall = fetchMock.mock.calls.find(c => c[1]?.method === "POST");
      expect(bindCall).toBeDefined();
      expect(String(bindCall![0])).toBe("/api/ships/s1/projects");
    });
  });

  it("shows an empty-state when only the loading completes with no rows", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderWithProviders(<ShipProjectsTab ship={ship} canManage={false} />);
    await waitFor(() => expect(screen.getByText("No additional projects bound.")).toBeInTheDocument());
  });
});
