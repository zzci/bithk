// Projects list: the section filter combined with every other dimension, and
// the ship-preset create path from the dialog through to the POST body.
//
// The assertions are on the OUTGOING REQUEST rather than on the rendered rows:
// the list is paginated server-side, so a filter that never reaches the query
// string would still look correct on page 1 while silently hiding matches.

import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ProjectsListPage } from "./index.lazy";

const navigateMock = vi.fn();
const searchMock = vi.fn<() => { section?: string }>(() => ({}));
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
  useNavigate: () => navigateMock,
  useSearch: () => searchMock(),
}));

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas Refit",
    status: "active",
    description: "Flagship refit programme",
    sections: ["issues", "procurement", "files", "ship-profile"],
    tags: [],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

const TAGS = [
  { id: "t1", name: "refit", usageCount: 2 },
  { id: "t2", name: "deck", usageCount: 1 },
];

/** Every `/projects` list request the page issued, in order. */
function listUrls(): string[] {
  return fetchMock.mock.calls.map(call => String(call[0])).filter(url => url.includes("/projects?"));
}

/** Bodies of every POST to `/projects`, parsed. */
function createBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(call => call[1]?.method === "POST" && String(call[0]).endsWith("/projects"))
    .map(call => JSON.parse(String(call[1]!.body)) as Record<string, unknown>);
}

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  searchMock.mockReset();
  searchMock.mockReturnValue({});
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  fetchMock.mockReset();
});

/** `total` rows in the list, the tag vocabulary, and a stub ship profile. */
function mockApi(total: number) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/tags"))
      return jsonResponse({ success: true, data: TAGS });
    if (url.includes("/ship-profile"))
      return jsonResponse({ success: true, data: { hullNumber: "H-1", shipStatus: "active", imoNumber: null, mmsi: null } });
    return jsonResponse({ success: true, data: [project()], meta: { total, page: 1, limit: 20 } });
  });
}

describe("projects list filter permutations", () => {
  beforeEach(() => {
    // The section filter round-trips through the URL, so the navigate mock
    // feeds the new value straight back to `useSearch` the way the router does.
    navigateMock.mockImplementation((opts: { to?: string; search?: { section?: string } }) => {
      if (opts.to === "/projects")
        searchMock.mockReturnValue(opts.search ?? {});
    });
  });

  it("carries section, status, tags, search and page in a single request", async () => {
    const user = userEvent.setup();
    searchMock.mockReturnValue({ section: "ship-profile" });
    // 45 rows over a 20-row page → three pages, so Next is reachable.
    mockApi(45);
    renderWithProviders(<ProjectsListPage />);
    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("menuitem", { name: /Archived/ }));

    await user.click(await screen.findByRole("button", { name: "Tags" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "refit" }));
    await user.keyboard("{Escape}");

    await user.type(screen.getByRole("textbox", { name: "Search projects" }), "atlas");
    await user.click(await screen.findByRole("button", { name: "Next" }));

    // One request carrying every dimension at once — not five requests that
    // each dropped the others.
    await waitFor(() => {
      expect(listUrls().some(url =>
        /[?&]section=ship-profile\b/.test(url)
        && /[?&]status=archived\b/.test(url)
        && /[?&]tagIds=t1\b/.test(url)
        && /[?&]q=atlas\b/.test(url)
        && /[?&]page=2\b/.test(url),
      )).toBe(true);
    });
  });

  it("resets to page 1 when the section filter changes", async () => {
    const user = userEvent.setup();
    searchMock.mockReturnValue({ section: "ship-profile" });
    mockApi(45);
    renderWithProviders(<ProjectsListPage />);
    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());

    await user.type(screen.getByRole("textbox", { name: "Search projects" }), "atlas");
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(listUrls().some(url => /[?&]page=2\b/.test(url))).toBe(true));

    // The trigger shows the applied value once the section filter is active.
    await user.click(screen.getByRole("button", { name: "Ships" }));
    await user.click(await screen.findByRole("menuitem", { name: "Equipment" }));

    // A narrower section can hold fewer pages, so staying on page 2 would strand
    // the user on an out-of-range page with an empty grid.
    await waitFor(() => {
      expect(listUrls().some(url =>
        /[?&]section=equipment\b/.test(url) && /[?&]page=1\b/.test(url) && /[?&]q=atlas\b/.test(url),
      )).toBe(true);
    });
    expect(listUrls().some(url => /[?&]section=equipment\b/.test(url) && /[?&]page=2\b/.test(url))).toBe(false);
  });

  it("resets to page 1 when the section filter is cleared", async () => {
    const user = userEvent.setup();
    searchMock.mockReturnValue({ section: "ship-profile" });
    mockApi(45);
    renderWithProviders(<ProjectsListPage />);
    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(listUrls().some(url => /[?&]page=2\b/.test(url))).toBe(true));

    await user.click(screen.getByRole("button", { name: "Ships" }));
    await user.click(await screen.findByRole("menuitem", { name: "All" }));

    await waitFor(() => {
      expect(listUrls().some(url => !url.includes("section=") && /[?&]page=1\b/.test(url))).toBe(true);
    });
  });
});

describe("ship-preset create", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { role: "admin", modules: [] } as never, loading: false });
  });

  /** Routes the list, the tag vocabulary and the create POST. */
  function mockCreate() {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST")
        return jsonResponse({ success: true, data: project({ id: "p9", name: "Atlas" }) });
      if (url.includes("/tags"))
        return jsonResponse({ success: true, data: TAGS });
      if (url.includes("/ship-profile"))
        return jsonResponse({ success: true, data: { hullNumber: "H-1", shipStatus: "active", imoNumber: null, mmsi: null } });
      return jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, limit: 20 } });
    });
  }

  it("posts preset ship with the vessel particulars under sectionData", async () => {
    const user = userEvent.setup();
    mockCreate();
    renderWithProviders(<ProjectsListPage />);

    await user.click(await screen.findByRole("button", { name: "New" }));
    await user.type(await screen.findByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("radio", { name: "Ship" }));
    await user.type(screen.getByLabelText("Hull number"), "HULL-7");
    await user.type(screen.getByLabelText("IMO number"), "IMO-1234567");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createBodies()).toHaveLength(1));
    const payload = createBodies()[0]!;
    expect(payload.preset).toBe("ship");
    const sectionData = payload.sectionData as Record<string, Record<string, unknown>>;
    // Keyed by the section's MOUNT key — the API hands this slice straight to
    // the ship-profile provision hook.
    expect(Object.keys(sectionData)).toEqual(["ship-profile"]);
    expect(sectionData["ship-profile"]!.hullNumber).toBe("HULL-7");
    expect(sectionData["ship-profile"]!.imoNumber).toBe("IMO-1234567");

    // The created project is opened, not just toasted.
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/projects/$projectId", params: { projectId: "p9" } }),
      );
    });
  });

  it("still submits with a blank hull number so the API generates one", async () => {
    const user = userEvent.setup();
    mockCreate();
    renderWithProviders(<ProjectsListPage />);

    await user.click(await screen.findByRole("button", { name: "New" }));
    await user.type(await screen.findByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("radio", { name: "Ship" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createBodies()).toHaveLength(1));
    const sectionData = createBodies()[0]!.sectionData as Record<string, Record<string, unknown>>;
    expect(sectionData["ship-profile"]).toBeDefined();
    // Omitted, not sent as null: a null would clear the auto-generated value.
    expect("hullNumber" in sectionData["ship-profile"]!).toBe(false);
  });

  it("posts the general preset without any section data", async () => {
    const user = userEvent.setup();
    mockCreate();
    renderWithProviders(<ProjectsListPage />);

    await user.click(await screen.findByRole("button", { name: "New" }));
    await user.type(await screen.findByLabelText("Name"), "Bridge");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createBodies()).toHaveLength(1));
    const payload = createBodies()[0]!;
    expect(payload.preset).toBe("general");
    expect("sectionData" in payload).toBe(false);
  });
});

// FIX-071: the maritime particulars ride on the list row itself
// (`sectionSummary["ship-profile"]`), so a page of ship cards costs exactly one
// request. The `/ship-profile` endpoint is mocked to FAIL here — a card that
// still fetched its own profile would render nothing.
describe("ship cards render from the list payload", () => {
  /** `count` ship rows, each carrying its own profile summary on the row. */
  function mockShipPage(count: number) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/tags"))
        return jsonResponse({ success: true, data: TAGS });
      if (url.includes("/ship-profile"))
        return new Response("gone", { status: 500 });
      const rows = Array.from({ length: count }, (_, i) => project({
        id: `p${i + 1}`,
        name: `Ship ${i + 1}`,
        sectionSummary: {
          "ship-profile": {
            hullNumber: `HULL-${i + 1}`,
            shipStatus: "active",
            imoNumber: `IMO-${i + 1}`,
            mmsi: `MMSI-${i + 1}`,
          },
        },
      }));
      return jsonResponse({ success: true, data: rows, meta: { total: count, page: 1, limit: 20 } });
    });
  }

  it("renders a full page of ship cards without a per-card profile lookup", async () => {
    mockShipPage(20);
    renderWithProviders(<ProjectsListPage />);

    expect(await screen.findByText("HULL-1")).toBeInTheDocument();
    // Every card in the page, not just the first — the summary travels with
    // each row rather than being fetched card by card.
    expect(screen.getByText("HULL-20")).toBeInTheDocument();
    expect(screen.getByText("IMO-20")).toBeInTheDocument();
    expect(screen.getByText("MMSI-20")).toBeInTheDocument();

    // ONE request carried all twenty cards. The only other list URLs are the
    // fixed `limit=1` status-count probes behind the Status filter, which do
    // not grow with the number of rows.
    expect(listUrls().filter(url => url.includes("limit=20"))).toHaveLength(1);
    // ...and not one card asked for its own profile.
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/ship-profile"))).toBe(false);
  });

  it("leaves a general project's card on its plain description body", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/tags"))
        return jsonResponse({ success: true, data: TAGS });
      if (url.includes("/ship-profile"))
        return new Response("gone", { status: 500 });
      return jsonResponse({
        success: true,
        data: [project({ sections: ["issues", "procurement", "files"] })],
        meta: { total: 1, page: 1, limit: 20 },
      });
    });
    renderWithProviders(<ProjectsListPage />);

    expect(await screen.findByText("Flagship refit programme")).toBeInTheDocument();
    expect(screen.queryByText("HULL-1")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/ship-profile"))).toBe(false);
  });
});
