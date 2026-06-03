import { screen, waitFor, within } from "@testing-library/react";
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

// Ship list requests and the ship-tag vocabulary (`/tags?type=ship`) share the
// same fetch mock; route by URL so the tag filter has real tags to render.
function defaultFetch(input: RequestInfo | URL): Promise<Response> {
  if (String(input).includes("/tags"))
    return Promise.resolve(jsonResponse({ success: true, data: [{ id: "tag-refit", name: "Refit" }] }));
  return Promise.resolve(jsonResponse(listPayload()));
}

function listPayload() {
  return {
    success: true,
    data: [{
      id: "s1",
      name: "Serenity",
      code: "HULL-1",
      status: "active",
      tags: [{ id: "tag-refit", name: "Refit" }],
      baseProjectId: "p1",
      model: "Container 300",
      builder: "North Dock",
      buildYear: 2014,
      lengthOverall: 299,
      beam: 40,
      draft: 14.5,
      grossTonnage: 95500,
      imoNumber: "9876543",
      mmsi: "413258900",
      callSign: "BHQO5",
      flagState: "Panama",
      registryPort: "Shanghai",
      ownerName: "Atlas Marine",
      description: null,
      creatorId: "u1",
      version: 1,
      updatedAt: "2026-05-25T00:00:00.000Z",
    }],
    meta: { total: 1, page: 1, limit: 20 },
  };
}

describe("shipsListPage", () => {
  it("renders the heading and a ship card with its status badge", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    expect(screen.getByRole("heading", { name: "Ships" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.getByText("HULL-1")).toBeInTheDocument();
    expect(screen.getByText("9876543")).toBeInTheDocument();
    expect(screen.getByText("Shanghai")).toBeInTheDocument();
  });

  it("hides the create entry for non-admins", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create ship" })).not.toBeInTheDocument();
  });

  it("shows the admin create entry", async () => {
    useAuthStore.setState({ user: { id: "u1", role: "admin" } as never });
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create ship" })).toBeInTheDocument();
  });

  it("renders the status filter options with fleet counts", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    // The status dimension is its own dropdown (default "active", so the trigger
    // shows the dimension label). Its options carry the per-status fleet counts
    // from the dedicated count query; there is no "all" option.
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Active\s*1/ })).toBeInTheDocument());
    expect(screen.queryByRole("menuitem", { name: /^All/ })).not.toBeInTheDocument();
  });

  it("defaults to the active status and renders the tag filter with no tag applied", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    // The initial list request carries the default active status and no tag.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => String(c[0]).includes("/ships?") && String(c[0]).includes("status=active") && !String(c[0]).includes("tagId="));
      expect(call).toBeDefined();
    });
    // The shared ListFilter renders the ship tag dimension as its own dropdown
    // trigger (no tag applied yet), replacing the old standalone tag-filter /
    // vessel-type control.
    expect(screen.getByRole("button", { name: "Tags" })).toBeInTheDocument();
    // The ship card surfaces its tag as a badge (scoped to the card).
    expect(within(screen.getByRole("button", { name: "Serenity" })).getByText("Refit")).toBeInTheDocument();
  });

  it("searches the whole fleet through the server", async () => {
    // Server-side search: the list endpoint applies `q`, so an empty result
    // for an unmatched term must come from the API, not a client page filter.
    fetchMock.mockImplementation((input) => {
      if (String(input).includes("/tags"))
        return Promise.resolve(jsonResponse({ success: true, data: [{ id: "tag-refit", name: "Refit" }] }));
      const q = new URL(String(input), "http://test").searchParams.get("q");
      if (q === "zzz")
        return Promise.resolve(jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, limit: 20 } }));
      return Promise.resolve(jsonResponse(listPayload()));
    });
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());

    const searchBox = screen.getByPlaceholderText("Search name, hull number, or IMO");
    await userEvent.type(searchBox, "zzz");
    await waitFor(() => expect(screen.queryByText("Serenity")).not.toBeInTheDocument());
    expect(screen.getByText("No ships match your search.")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("q=zzz"))).toBe(true),
    );

    await userEvent.clear(searchBox);
    await userEvent.type(searchBox, "seren");
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
  });

  it("refetches with a status filter when a status chip is selected", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Archived/ }));
    await waitFor(() => {
      const filtered = fetchMock.mock.calls.find(c => String(c[0]).includes("status=archived"));
      expect(filtered).toBeDefined();
    });
  });
});
