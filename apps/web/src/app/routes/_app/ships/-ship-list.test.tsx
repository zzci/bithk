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
      airDraft: 38.5,
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
    const card = screen.getByRole("button", { name: "Serenity" });
    // The header now surfaces three copyable identifiers: IMO, MMSI, and location.
    expect(within(card).getByText("9876543")).toBeInTheDocument();
    expect(within(card).getByText("413258900")).toBeInTheDocument();
    expect(within(card).getByText("Shanghai")).toBeInTheDocument();
    // Each identifier row carries a leading copy button.
    expect(within(card).getAllByRole("button", { name: "Copy" }).length).toBeGreaterThanOrEqual(3);
    // Status badge restored.
    expect(within(card).getByText("Active")).toBeInTheDocument();
    // The four physical specs render their labels + values; build year / age / flag are gone.
    expect(within(card).getByText("Length overall (m)")).toBeInTheDocument();
    expect(within(card).getByText("Beam (m)")).toBeInTheDocument();
    expect(within(card).getByText("Draft (m)")).toBeInTheDocument();
    expect(within(card).getByText("Air draft")).toBeInTheDocument();
    expect(within(card).getByText("38.5")).toBeInTheDocument();
    expect(within(card).getByText("Gross tonnage")).toBeInTheDocument();
    expect(within(card).getByText("299")).toBeInTheDocument();
    expect(within(card).getByText("95500")).toBeInTheDocument();
    // Hull code no longer renders on the card.
    expect(within(card).queryByText("HULL-1")).not.toBeInTheDocument();
    // Tag still shown.
    expect(within(card).getByText("Refit")).toBeInTheDocument();
  });

  it("hides the create entry for non-admins", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("shows the admin create entry", async () => {
    useAuthStore.setState({ user: { id: "u1", role: "admin" } as never });
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("renders the status filter options with fleet counts", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    // The status dimension is its own dropdown (default unset, so the trigger
    // shows the dimension label). Its options carry the per-status fleet counts
    // from the dedicated count query; there is no "all" option.
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Active\s*1/ })).toBeInTheDocument());
    expect(screen.queryByRole("menuitem", { name: /^All/ })).not.toBeInTheDocument();
  });

  it("defaults to no status filter and renders the tag filter with no tag applied", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());
    // The initial list request carries no status param (default view = every
    // status except retired) and no tag. The per-status count queries DO carry
    // `status=`, so match the list request by limit=20 (counts use limit=1).
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => String(c[0]).includes("/ships?") && String(c[0]).includes("limit=20") && !String(c[0]).includes("status=") && !String(c[0]).includes("tagId="));
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

  it("opens the cover lightbox without navigating the card", async () => {
    // A ship with a cover image opts the list card into the click-to-enlarge
    // lightbox; clicking the cover must open the modal but not navigate.
    const base = listPayload();
    const withCover = {
      ...base,
      data: [{ ...base.data[0], coverImageUrl: "/api/files/cover.jpg" }],
    };
    fetchMock.mockImplementation((input) => {
      if (String(input).includes("/tags"))
        return Promise.resolve(jsonResponse({ success: true, data: [{ id: "tag-refit", name: "Refit" }] }));
      return Promise.resolve(jsonResponse(withCover));
    });
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());

    const card = screen.getByRole("button", { name: "Serenity" });
    await userEvent.click(within(card).getByRole("button", { name: "View larger image" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img")).toBeInTheDocument();
    // stopPropagation keeps the card's onClick from firing.
    expect(navigateMock).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("refetches with a status filter when a status chip is selected", async () => {
    fetchMock.mockImplementation(defaultFetch);
    renderWithProviders(<ShipsListPage />);
    await waitFor(() => expect(screen.getByText("Serenity")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Retired/ }));
    await waitFor(() => {
      // The main list refetches with the chosen status; limit=20 distinguishes
      // it from the per-status count queries (limit=1), which also hit retired.
      const filtered = fetchMock.mock.calls.find(c => String(c[0]).includes("status=retired") && String(c[0]).includes("limit=20"));
      expect(filtered).toBeDefined();
    });
  });
});
