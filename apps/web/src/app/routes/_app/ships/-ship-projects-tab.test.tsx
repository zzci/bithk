import type { ProjectView } from "@/shared/lib/api/projects";
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
  // Returned out of order — the non-base project first — to prove the tab pulls
  // the base project to the top before rendering.
  return [
    { id: "p2", name: "Refit 2026", code: "RF", isBase: false } as ShipProjectView,
    { id: "p1", name: "Base ops", code: "OPS", isBase: true } as ShipProjectView,
  ];
}

// Fleet candidates for the picker: one unbound (bindable) and one already
// attached to another ship (must be filtered out of the candidate list).
function candidatesPayload(): readonly ProjectView[] {
  return [
    { id: "p9", name: "Spare hull", code: "SP", shipId: null } as ProjectView,
    { id: "p7", name: "Owned project", code: "OW", shipId: "s2" } as ProjectView,
  ];
}

// Route fetch by URL + method so the picker's candidate/create calls and the
// ship's bind/list calls each get the right envelope shape.
function installFetch(
  opts: { projects?: readonly ShipProjectView[]; candidates?: readonly ProjectView[] } = {},
) {
  const shipProjects = opts.projects ?? projectsPayload();
  const candidates = opts.candidates ?? candidatesPayload();
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    // Ship project list (GET) and bind (POST) share this path.
    if (url.startsWith("/api/ships/s1/projects"))
      return Promise.resolve(jsonResponse({ success: true, data: shipProjects }));
    // Create project (POST) → a fresh unbound project.
    if (url.startsWith("/api/projects") && method === "POST")
      return Promise.resolve(jsonResponse({ success: true, data: { id: "pnew", name: "Brand new", code: null, shipId: null } }));
    // Candidate list (GET) → paginated envelope.
    if (url.startsWith("/api/projects"))
      return Promise.resolve(jsonResponse({ success: true, data: candidates, meta: { total: candidates.length, page: 1, limit: 50 } }));
    return Promise.resolve(jsonResponse({ success: true, data: [] }));
  });
}

describe("shipProjectsTab", () => {
  it("renders the base project with a Base badge and no unbind action", async () => {
    installFetch();
    renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Base ops")).toBeInTheDocument());
    expect(screen.getByText("Base")).toBeInTheDocument();
    // Exactly one unbind button — the base project is not unbindable.
    expect(screen.getAllByRole("button", { name: "Unbind" })).toHaveLength(1);
  });

  it("sorts the base project ahead of bound projects regardless of server order", async () => {
    installFetch();
    renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Base ops")).toBeInTheDocument());
    const base = screen.getByText("Base ops");
    const other = screen.getByText("Refit 2026");
    // Base comes first in document order even though the API returned it last.
    expect(base.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the New picker button for managers and hides it otherwise", async () => {
    installFetch();
    const { rerender } = renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();

    rerender(<ShipProjectsTab ship={ship} canManage={false} />);
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    // Non-managers see no unbind actions at all.
    expect(screen.queryByRole("button", { name: "Unbind" })).not.toBeInTheDocument();
  });

  it("binds an unbound candidate from the picker, hiding ship-attached ones", async () => {
    installFetch();
    renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    // The unbound project shows; the one attached to another ship is filtered out.
    await waitFor(() => expect(screen.getByText("Spare hull")).toBeInTheDocument());
    expect(screen.queryByText("Owned project")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bind" }));
    await waitFor(() => {
      const bindCall = fetchMock.mock.calls.find(
        c => c[1]?.method === "POST" && String(c[0]) === "/api/ships/s1/projects",
      );
      expect(bindCall).toBeDefined();
      expect(JSON.parse(String(bindCall![1]?.body))).toEqual({ projectShortId: "p9" });
    });
  });

  it("creates a project and auto-binds it from the Create new tab", async () => {
    installFetch();
    renderWithProviders(<ShipProjectsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("tab", { name: "Create new" }));
    await userEvent.type(screen.getByLabelText("Project name"), "Brand new");
    await userEvent.click(screen.getByRole("button", { name: "Bind" }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        c => c[1]?.method === "POST" && String(c[0]) === "/api/projects",
      );
      expect(createCall).toBeDefined();
      const bindCall = fetchMock.mock.calls.find(
        c => c[1]?.method === "POST" && String(c[0]) === "/api/ships/s1/projects",
      );
      expect(bindCall).toBeDefined();
      // The created project's id is what gets bound.
      expect(JSON.parse(String(bindCall![1]?.body))).toEqual({ projectShortId: "pnew" });
    });
  });

  it("shows an empty-state when only the loading completes with no rows", async () => {
    installFetch({ projects: [] });
    renderWithProviders(<ShipProjectsTab ship={ship} canManage={false} />);
    await waitFor(() => expect(screen.getByText("No additional projects bound.")).toBeInTheDocument());
  });
});
