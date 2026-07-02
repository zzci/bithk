import type { ReactNode } from "react";
import type { FavoriteItem, OverviewData } from "@/shared/lib/api/favorites";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";

// The overview route only exports `Route`; its component is closed over by
// `createLazyFileRoute`. Reduce the route factory to an identity so the test
// can reach `Route.component`, and stub `Link` as a plain anchor (no router
// context is mounted here; `params` are left uninterpolated in `href`).
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className} data-testid="overview-link">{children}</a>
  ),
}));

const { Route } = await import("./overview.lazy");
// The mock collapses the route to its plain options object; reach the component.
const OverviewPage = (Route as unknown as { component: () => ReactNode }).component;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

function routeFetch(favorites: FavoriteItem[] = [], overview: OverviewData = { myIssues: [], openProcurements: [] }) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes("/favorites"))
      return jsonResponse({ success: true, data: favorites });
    if (path.includes("/overview"))
      return jsonResponse({ success: true, data: overview });
    return jsonResponse({ success: true, data: [] });
  });
}

function setUser(modules: readonly string[], name = "Alice Liddell") {
  useAuthStore.setState({
    user: { name, username: "alice", modules } as never,
    loading: false,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  routeFetch();
  globalThis.fetch = fetchMock;
  setUser(["projects", "documents"]);
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: true });
});

describe("overviewPage", () => {
  it("greets the signed-in user by name and shows the page description", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByRole("heading", { name: "Welcome, Alice Liddell" })).toBeInTheDocument();
    expect(screen.getByText("Welcome to your workspace.")).toBeInTheDocument();
  });

  it("renders the workbench sections with empty states when nothing is pinned or assigned", async () => {
    renderWithProviders(<OverviewPage />);
    expect(await screen.findByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("My work orders")).toBeInTheDocument();
    expect(screen.getByText("Open procurements")).toBeInTheDocument();
    expect(await screen.findByText(/Nothing pinned yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByText("No open work orders assigned to you.")).toBeInTheDocument();
    expect(screen.getByText("No procurements in progress.")).toBeInTheDocument();
  });

  it("renders hydrated favorites with unfavorite toggles and workbench rows", async () => {
    routeFetch(
      [
        { targetType: "project", id: "pj1", name: "Tower", code: "TWR", status: "active", favoritedAt: "2026-07-01T00:00:00Z" },
        { targetType: "issue", id: "is1", title: "Fix pump", status: "todo", priority: "high", dueDate: null, projectId: "pj1", projectName: "Tower", favoritedAt: "2026-07-01T00:00:00Z" },
      ],
      {
        myIssues: [
          { id: "is2", title: "Inspect hull", status: "working", priority: "medium", dueDate: null, projectId: "pj1", projectName: "Tower", updatedAt: "2026-07-01T00:00:00Z" },
        ],
        openProcurements: [
          { id: "pr1", itemName: "Anchor chain", status: "requested", priority: "medium", amount: null, currency: null, dueDate: null, projectId: "pj1", projectName: "Tower", updatedAt: "2026-07-01T00:00:00Z" },
        ],
      },
    );

    renderWithProviders(<OverviewPage />);
    // "Tower" renders as the project favorite's title AND as the project name
    // on the issue/procurement rows — assert presence, not uniqueness.
    expect((await screen.findAllByText("Tower")).length).toBeGreaterThan(0);
    expect(screen.getByText("Fix pump")).toBeInTheDocument();
    expect(screen.getByText("Inspect hull")).toBeInTheDocument();
    expect(screen.getByText("Anchor chain")).toBeInTheDocument();
    // One unfavorite toggle per favorite row.
    expect(screen.getAllByRole("button", { name: "Remove from favorites" })).toHaveLength(2);
  });

  it("falls back to module-gated quick-nav tiles without the projects module", () => {
    setUser(["documents"]);
    renderWithProviders(<OverviewPage />);
    expect(screen.getByRole("link", { name: /Documents/ })).toHaveAttribute("href", "/documents");
    expect(screen.queryByRole("link", { name: /Projects/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
  });
});
