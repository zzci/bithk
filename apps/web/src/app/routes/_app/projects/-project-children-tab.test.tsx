import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectChildrenTab } from "./-project-children-tab";

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

function view(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p9",
    code: "SP",
    name: "Spare hull",
    status: "active",
    description: null,
    sections: ["issues", "procurement", "files"],
    tags: [],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}

const parent = view({ id: "p1", code: "OPS", name: "Serenity", sections: ["ship-profile"] });
// The same tab on a project that mounts no maritime section at all — nothing in
// the tab body, the empty state or the add dialog branches on the ship preset.
const generalParent = view({ id: "p1", code: "OPS", name: "Serenity", sections: ["issues", "procurement", "files"] });

function childrenPayload(): readonly ProjectView[] {
  return [view({ id: "p2", code: "RF", name: "Refit 2026" })];
}

// Route by URL + method so the picker's candidate/create calls and the parent's
// children list/link calls each get the right envelope shape.
function installFetch(
  opts: { children?: readonly ProjectView[]; candidates?: readonly ProjectView[] } = {},
) {
  const children = opts.children ?? childrenPayload();
  const candidates = opts.candidates ?? [view(), view({ id: "p1", code: "OPS", name: "Serenity" })];
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    // Link (PUT) / unlink (DELETE) a specific child.
    if (/\/api\/projects\/p1\/children\/\w+$/.test(url))
      return Promise.resolve(jsonResponse({ success: true, data: method === "DELETE" ? null : view() }));
    // Children list (GET) and create-child (POST) share this path.
    if (url.startsWith("/api/projects/p1/children")) {
      return Promise.resolve(jsonResponse({
        success: true,
        data: method === "POST" ? view({ id: "pnew", name: "Brand new", code: "BN" }) : children,
      }));
    }
    // Candidate list (GET) → paginated envelope.
    if (url.startsWith("/api/projects"))
      return Promise.resolve(jsonResponse({ success: true, data: candidates, meta: { total: candidates.length, page: 1, limit: 50 } }));
    return Promise.resolve(jsonResponse({ success: true, data: [] }));
  });
}

describe("projectChildrenTab", () => {
  it("lists the project's children with an unlink action for managers", async () => {
    installFetch();
    renderWithProviders(<ProjectChildrenTab project={parent} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Unlink" })).toHaveLength(1);
  });

  it("shows the add picker for managers and hides every write action otherwise", async () => {
    installFetch();
    const { rerender } = renderWithProviders(<ProjectChildrenTab project={parent} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();

    rerender(<ProjectChildrenTab project={parent} canManage={false} />);
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink" })).not.toBeInTheDocument();
  });

  it("links an existing project as a child, excluding the parent and current children", async () => {
    installFetch();
    renderWithProviders(<ProjectChildrenTab project={parent} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await waitFor(() => expect(screen.getByText("Spare hull")).toBeInTheDocument());
    // The parent itself is never a candidate for its own children list.
    expect(screen.queryByText("Serenity")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => {
      const link = fetchMock.mock.calls.find(
        c => (c[1]?.method ?? "").toUpperCase() === "PUT" && String(c[0]) === "/api/projects/p1/children/p9",
      );
      expect(link).toBeDefined();
    });
  });

  it("creates a sub-project already parented from the Create new tab", async () => {
    installFetch();
    renderWithProviders(<ProjectChildrenTab project={parent} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("tab", { name: "Create new" }));
    await userEvent.type(screen.getByLabelText("Project name"), "Brand new");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      const create = fetchMock.mock.calls.find(
        c => (c[1]?.method ?? "").toUpperCase() === "POST" && String(c[0]) === "/api/projects/p1/children",
      );
      expect(create).toBeDefined();
      expect(JSON.parse(String(create![1]?.body))).toEqual({ name: "Brand new", code: null });
    });
  });

  it("unlinks a child through the children route", async () => {
    installFetch();
    renderWithProviders(<ProjectChildrenTab project={parent} canManage />);
    await waitFor(() => expect(screen.getByText("Refit 2026")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    // The confirm dialog repeats the label; the last one is its confirm button.
    await userEvent.click(screen.getAllByRole("button", { name: "Unlink" }).at(-1)!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        c => (c[1]?.method ?? "").toUpperCase() === "DELETE" && String(c[0]) === "/api/projects/p1/children/p2",
      );
      expect(del).toBeDefined();
    });
  });

  it("shows the empty state when the project has no children", async () => {
    installFetch({ children: [] });
    renderWithProviders(<ProjectChildrenTab project={parent} canManage={false} />);
    await waitFor(() => expect(screen.getByText("No sub-projects yet.")).toBeInTheDocument());
  });

  it("offers the add action from a general project's empty state with project.manage", async () => {
    installFetch({ children: [] });
    const { rerender } = renderWithProviders(<ProjectChildrenTab project={generalParent} canManage />);
    await waitFor(() => expect(screen.getByText("No sub-projects yet.")).toBeInTheDocument());

    // `project.manage` is the only gate — the ship preset has no say.
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    expect(await screen.findByText("Link a sub-project")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Create new" })).toBeInTheDocument();

    rerender(<ProjectChildrenTab project={generalParent} canManage={false} />);
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});
