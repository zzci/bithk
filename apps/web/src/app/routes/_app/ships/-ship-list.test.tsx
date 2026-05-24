import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ShipsListPage } from "./index.lazy";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  // createLazyFileRoute("/path")({ component }) → return the options unchanged
  // so importing the module does not require a real router.
  createLazyFileRoute: () => (opts: unknown) => opts,
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
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  fetchMock.mockReset();
});

function listPayload(stage = "design") {
  return {
    success: true,
    data: [{ id: "s1", name: "Serenity", code: "HULL-1", status: "active", lifecycleStage: stage }],
    meta: { total: 1, page: 1, limit: 20 },
  };
}

describe("shipsListPage", () => {
  it("renders the heading and a ship card with its lifecycle badge", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listPayload()));
    renderWithProviders(<ShipsListPage />);
    expect(screen.getByRole("heading", { name: "Ships" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.getByText("HULL-1")).toBeInTheDocument();
  });

  it("hides the create entry for non-admins", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listPayload()));
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create ship" })).not.toBeInTheDocument();
  });

  it("shows the admin create entry", async () => {
    useAuthStore.setState({ user: { id: "u1", role: "admin" } as never });
    fetchMock.mockResolvedValue(jsonResponse(listPayload()));
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create ship" })).toBeInTheDocument();
  });

  it("refetches with a lifecycleStage filter when a stage chip is selected", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listPayload()));
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "In service" }));
    await waitFor(() => {
      const filtered = fetchMock.mock.calls.find(c => String(c[0]).includes("lifecycleStage=in_service"));
      expect(filtered).toBeDefined();
    });
  });
});
