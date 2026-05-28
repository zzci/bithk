import type { ProjectIssueRow, ProjectMemberView } from "@/shared/lib/api/projects";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectIssuesTab } from "./-project-issues-tab";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
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

function issue(overrides: Partial<ProjectIssueRow> = {}): ProjectIssueRow {
  return {
    id: "i1",
    projectId: "p1",
    title: "Fix leak",
    description: null,
    status: "open",
    priority: "high",
    assigneeId: null,
    assigneeMemberId: null,
    dueDate: null,
    creatorId: "u1",
    pinned: false,
    pinnedAt: null,
    version: 1,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  } as ProjectIssueRow;
}

// The grouped tab queries one list per status, so the mock honours the `status`
// query param and returns only the matching issues (with a matching total).
function routeFetch(issues: ProjectIssueRow[]) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    let matched = status ? issues.filter(i => i.status === status) : issues;
    if (q)
      matched = matched.filter(i => i.title.toLowerCase().includes(q.toLowerCase()));
    return jsonResponse({ success: true, data: matched, meta: { total: matched.length, page: 1, limit: 20 } });
  });
}

const noMembers: never[] = [];

function member(overrides: Partial<ProjectMemberView> = {}): ProjectMemberView {
  return {
    id: "m1",
    userId: "u1",
    displayName: null,
    roleId: "r1",
    title: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectIssuesTab", () => {
  it("renders the empty state when there are no work orders", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    expect(await screen.findByText("No work orders found.")).toBeInTheDocument();
  });

  it("renders an issue row under its status section with priority and unassigned marker", async () => {
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    expect(await screen.findByText("Fix leak")).toBeInTheDocument();
    // `open` is grouped under the product label "Todo".
    expect(screen.getByRole("region", { name: "Todo" })).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders a row left-to-right with title, priority, assignee, and due date", async () => {
    routeFetch([issue({ priority: "urgent", assigneeMemberId: "m1", dueDate: "2026-06-15" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={[member()]} userNames={new Map([["u1", "Alice"]])} />);
    const row = await screen.findByRole("button", { name: /Fix leak/ });
    expect(within(row).getByText("Fix leak")).toBeInTheDocument();
    expect(within(row).getByText("Urgent")).toBeInTheDocument();
    expect(within(row).getByText("Alice")).toBeInTheDocument();
    expect(within(row).getByText("2026-06-15")).toBeInTheDocument();
  });

  it("navigates to the issue drawer route when a row is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await user.click(await screen.findByText("Fix leak"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/projects/$projectId/issues/$issueId",
      params: { projectId: "p1", issueId: "i1" },
    });
  });

  it("applies the debounced title search to the issues query", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    await user.type(screen.getByPlaceholderText("Search work orders..."), "pump");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("q=pump"))).toBe(true);
    });
  });

  it("keeps search and create as the primary top toolbar actions, with no priority filter", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("No work orders found.");
    // Search input and create button both live in the top toolbar.
    expect(screen.getByPlaceholderText("Search work orders...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create work order" })).toBeInTheDocument();
    // The priority filter control is gone from the visible top controls.
    expect(screen.queryByRole("button", { name: "Priority" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All priorities" })).not.toBeInTheDocument();
  });

  it("filters the list when a top status filter chip is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "open" }),
      issue({ id: "i2", title: "Close report", status: "done" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByText("Close report")).toBeInTheDocument();

    const filterGroup = screen.getByRole("group", { name: "Filter by status" });
    await user.click(within(filterGroup).getByRole("button", { name: /Completed/ }));

    // Only the selected status section remains.
    expect(screen.getByText("Close report")).toBeInTheDocument();
    expect(screen.queryByText("Fix leak")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Todo" })).not.toBeInTheDocument();
  });

  it("filters by status when a section header is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "open" }),
      issue({ id: "i2", title: "Mid task", status: "in_progress" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByRole("region", { name: "In Progress" })).toBeInTheDocument();

    const todoRegion = screen.getByRole("region", { name: "Todo" });
    await user.click(within(todoRegion).getByRole("button", { name: /Todo/ }));

    // Selecting Todo via its header collapses the view to just that status.
    expect(screen.getByText("Fix leak")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "In Progress" })).not.toBeInTheDocument();
    expect(screen.queryByText("Mid task")).not.toBeInTheDocument();
  });

  it("renders a separate status section with its own count for populated statuses only", async () => {
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "open" }),
      issue({ id: "i2", title: "Align shaft", status: "open" }),
      issue({ id: "i3", title: "Close report", status: "in_progress" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);

    const openGroup = await screen.findByRole("region", { name: "Todo" });
    expect(within(openGroup).getByText("2")).toBeInTheDocument();
    expect(within(openGroup).getByText("Fix leak")).toBeInTheDocument();
    expect(within(openGroup).getByText("Align shaft")).toBeInTheDocument();

    const inProgressGroup = screen.getByRole("region", { name: "In Progress" });
    expect(within(inProgressGroup).getByText("1")).toBeInTheDocument();
    expect(within(inProgressGroup).getByText("Close report")).toBeInTheDocument();

    // Empty statuses (Completed, Cancelled) are hidden in the "all" view.
    expect(screen.queryByRole("region", { name: "Completed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cancelled" })).not.toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "denied" } },
      { status: 403 },
    ));
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await waitFor(() => expect(screen.getByText("Failed to load data")).toBeInTheDocument());
  });

  it("creates a work order through the composer", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={[member()]} userNames={new Map([["u1", "Alice"]])} />,
    );
    await screen.findByText("No work orders found.");

    await user.click(screen.getByRole("button", { name: "Create work order" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByPlaceholderText("Title"), "Replace pump seal");

    // Status pill defaults to Todo (open); switch to In Progress.
    await user.click(within(dialog).getByRole("button", { name: /Todo/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "In Progress" }));

    // Priority pill defaults to Medium; pick High.
    await user.click(within(dialog).getByRole("button", { name: /Medium/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "High" }));

    // Assignee pill: pick the project member.
    await user.click(within(dialog).getByRole("button", { name: /Assignee/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Alice" }));

    fireEvent.change(within(dialog).getByLabelText("Due date", { selector: "input" }), { target: { value: "2026-06-15" } });

    await user.click(within(dialog).getByRole("button", { name: "Create work order" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
      expect(String(post![0])).toContain("/projects/p1/issues");
      const body = JSON.parse(String(post![1]!.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        title: "Replace pump seal",
        status: "in_progress",
        priority: "high",
        assigneeMemberId: "m1",
        dueDate: "2026-06-15",
      });
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }, 15000);

  it("shows a roomy multi-line description field in the create dialog", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("No work orders found.");
    await user.click(screen.getByRole("button", { name: "Create work order" }));
    const description = await screen.findByLabelText("Description");
    expect(description.tagName).toBe("TEXTAREA");
    expect(Number(description.getAttribute("rows"))).toBeGreaterThanOrEqual(4);
  });

  it("pins an issue row via POST when the viewer can manage", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("Fix leak");
    await user.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes("/pin"));
      expect(post).toBeDefined();
      expect(String(post![0])).toContain("/projects/p1/issues/i1/pin");
    });
  });

  it("hides the pin toggle from viewers who cannot manage or own the issue", async () => {
    routeFetch([issue()]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />,
    );
    await screen.findByText("Fix leak");
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
  });
});
