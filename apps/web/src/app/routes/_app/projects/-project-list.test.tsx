import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ProjectsListPage } from "./index.lazy";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
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

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas Refit",
    status: "active",
    description: "Flagship refit programme",
    sections: ["issues", "procurement", "files"],
    tags: [{ id: "t1", name: "refit", usageCount: 1 }],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

// Routes the list payload to /projects (needs meta) and an empty tag list to
// /tags (a plain envelope) so the tag filter does not pick up project rows.
function mockList(projects: readonly ProjectView[]) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/tags"))
      return jsonResponse({ success: true, data: [] });
    return jsonResponse({
      success: true,
      data: projects,
      meta: { total: projects.length, page: 1, limit: 20 },
    });
  });
}

describe("projectsListPage", () => {
  it("renders a project description in the card body", async () => {
    mockList([project()]);
    renderWithProviders(<ProjectsListPage />);

    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());
    expect(screen.getByText("Flagship refit programme")).toBeInTheDocument();
  });

  it("omits the description paragraph when there is no meaningful content", async () => {
    mockList([
      project({ id: "p1", name: "No Desc", description: null }),
      project({ id: "p2", name: "Blank Desc", description: "   " }),
    ]);
    renderWithProviders(<ProjectsListPage />);

    await waitFor(() => expect(screen.getByText("No Desc")).toBeInTheDocument());
    const blankCard = screen.getByText("Blank Desc").closest("[data-slot=\"card\"]");
    expect(blankCard).not.toBeNull();
    // A whitespace-only description must not render a paragraph node.
    expect(blankCard!.querySelector("p")).toBeNull();
  });

  it("reserves the bottom tag-row space even for projects without tags", async () => {
    mockList([project({ tags: [] })]);
    renderWithProviders(<ProjectsListPage />);

    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());
    const card = screen.getByText("Atlas Refit").closest("[data-slot=\"card\"]");
    expect(card).not.toBeNull();
    // The placeholder tag row is always present so card heights stay aligned.
    expect(card!.querySelector("div.min-h-5")).not.toBeNull();
  });

  it("places the description and tag area on separate stacked rows", async () => {
    mockList([project()]);
    renderWithProviders(<ProjectsListPage />);

    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());
    const card = screen.getByText("Atlas Refit").closest("[data-slot=\"card\"]");
    expect(card).not.toBeNull();

    const description = screen.getByText("Flagship refit programme");
    const tagChip = screen.getByText("refit");
    const tagRow = card!.querySelector("div.min-h-5");
    expect(tagRow).not.toBeNull();

    // The description is its own paragraph row, the tags live in the reserved
    // tag row, and neither is nested inside the other — a merge into one
    // line/metadata cluster would break at least one of these assertions.
    expect(description.tagName).toBe("P");
    expect(description.contains(tagChip)).toBe(false);
    expect(tagRow!.contains(description)).toBe(false);
    expect(tagRow!.contains(tagChip)).toBe(true);
    // Both rows are direct siblings inside the same column-stacked container.
    expect(description.parentElement).toBe(tagRow!.parentElement);
    expect(description.parentElement?.className).toContain("flex-col");
  });

  it("pushes search to the server q param instead of filtering the loaded page", async () => {
    mockList([project()]);
    renderWithProviders(<ProjectsListPage />);
    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());

    await userEvent.type(screen.getByRole("textbox", { name: "Search projects" }), "atlas");

    // Debounced search reaches the list endpoint as a `q` param (whole-list,
    // server-side) rather than being applied client-side over the current page.
    await waitFor(() => {
      const listUrls = fetchMock.mock.calls
        .map(call => String(call[0]))
        .filter(url => url.includes("/projects?"));
      expect(listUrls.some(url => /[?&]q=atlas\b/.test(url))).toBe(true);
    });
  });

  it("threads multiple selected tags into the list query as removable chips", async () => {
    // Route the tag vocabulary to /tags and the project rows to /projects so the
    // multi-select tags filter has options to pick from.
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/tags"))
        return jsonResponse({ success: true, data: [{ id: "t1", name: "refit", usageCount: 1 }, { id: "t2", name: "deck", usageCount: 1 }] });
      return jsonResponse({
        success: true,
        data: [project()],
        meta: { total: 1, page: 1, limit: 20 },
      });
    });
    renderWithProviders(<ProjectsListPage />);
    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());

    // Open the multi-select tags dropdown and check two tags (the menu stays
    // open between checkbox toggles).
    await userEvent.click(await screen.findByRole("button", { name: "Tags" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "refit" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "deck" }));

    // Both ids reach the list endpoint as repeatable (OR/union) tagIds params.
    await waitFor(() => {
      const listUrls = fetchMock.mock.calls
        .map(call => String(call[0]))
        .filter(url => url.includes("/projects?"));
      expect(listUrls.some(url => /[?&]tagIds=t1\b/.test(url) && /[?&]tagIds=t2\b/.test(url))).toBe(true);
    });

    // Each selected tag surfaces as its own removable chip.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Remove refit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove deck" })).toBeInTheDocument();
  });

  it("keeps existing tag chip rendering for tagged projects", async () => {
    mockList([
      project({
        tags: [
          { id: "t1", name: "refit", usageCount: 1 },
          { id: "t2", name: "deck", usageCount: 1 },
          { id: "t3", name: "hull", usageCount: 1 },
          { id: "t4", name: "engine", usageCount: 1 },
        ],
      }),
    ]);
    renderWithProviders(<ProjectsListPage />);

    await waitFor(() => expect(screen.getByText("Atlas Refit")).toBeInTheDocument());
    expect(screen.getByText("refit")).toBeInTheDocument();
    expect(screen.getByText("deck")).toBeInTheDocument();
    expect(screen.getByText("hull")).toBeInTheDocument();
    // Only the first three chips render; the rest collapse into the overflow.
    expect(screen.queryByText("engine")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
