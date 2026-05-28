import type { ProjectIssueRow, ProjectMemberView } from "@/shared/lib/api/projects";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectIssuesSearch, ProjectIssuesTab } from "./-project-issues-tab";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
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
    assigneeMemberId: null,
    dueDate: null,
    creatorId: "u1",
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
    const matched = status ? issues.filter(i => i.status === status) : issues;
    return jsonResponse({ success: true, data: matched, meta: { total: matched.length, page: 1, limit: 20 } });
  });
}

const noMembers: never[] = [];

describe("projectIssuesTab", () => {
  it("renders the empty state when there are no work orders", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    expect(await screen.findByText("No work orders found.")).toBeInTheDocument();
  });

  it("renders an issue row with status and priority badges and the unassigned marker", async () => {
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    expect(await screen.findByText("Fix leak")).toBeInTheDocument();
    // `open` is grouped under the product label "Todo".
    expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders a row left-to-right with title, priority, assignee, and due date", async () => {
    const members: ProjectMemberView[] = [{
      id: "m1",
      userId: "u1",
      displayName: null,
      roleId: "r1",
      title: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
    }];
    routeFetch([issue({ id: "i1", title: "Fix leak", status: "open", priority: "urgent", assigneeMemberId: "m1", dueDate: "2026-06-15" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={members} userNames={new Map([["u1", "Alice"]])} />);
    const row = await screen.findByRole("button", { name: /Fix leak/ });
    expect(within(row).getByText("Fix leak")).toBeInTheDocument();
    expect(within(row).getByText("Urgent")).toBeInTheDocument();
    expect(within(row).getByText("Alice")).toBeInTheDocument();
    expect(within(row).getByText("2026-06-15")).toBeInTheDocument();
  });

  it("navigates to the issue detail when a row is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await user.click(await screen.findByText("Fix leak"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/projects/$projectId/issues/$issueId",
      params: { projectId: "p1", issueId: "i1" },
    });
  });

  it("applies the controlled search prop to the issues query", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} search="pump" />);
    await screen.findByText("No work orders found.");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("q=pump"))).toBe(true);
    });
  });

  it("exposes a header search popover that reports input changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ProjectIssuesSearch value="" onChange={onChange} />);
    // Search is a compact trigger, not a permanently visible input.
    expect(screen.queryByPlaceholderText("Search work orders...")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search work orders..." }));
    await user.type(await screen.findByPlaceholderText("Search work orders..."), "p");
    expect(onChange).toHaveBeenCalledWith("p");
  });

  it("surfaces a load error", async () => {
    // Each status group fires its own request, so return a fresh response per
    // call rather than sharing one (a Response body can only be read once).
    fetchMock.mockImplementation(async () => jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "denied" } },
      { status: 403 },
    ));
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await waitFor(() => expect(screen.getByText("Failed to load data")).toBeInTheDocument());
  });

  it("renders a separate status group with its own count for populated statuses only", async () => {
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "open" }),
      issue({ id: "i2", title: "Align shaft", status: "open" }),
      issue({ id: "i3", title: "Close report", status: "in_progress" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);

    // `open` renders under the product label "Todo", `done` under "Completed".
    const openGroup = await screen.findByRole("region", { name: "Todo" });
    expect(within(openGroup).getByText("2")).toBeInTheDocument();
    expect(within(openGroup).getByText("Fix leak")).toBeInTheDocument();
    expect(within(openGroup).getByText("Align shaft")).toBeInTheDocument();

    const inProgressGroup = screen.getByRole("region", { name: "In Progress" });
    expect(within(inProgressGroup).getByText("1")).toBeInTheDocument();
    expect(within(inProgressGroup).getByText("Close report")).toBeInTheDocument();

    // Empty statuses (here Completed and Cancelled) are hidden so the list shows
    // only populated groups.
    expect(screen.queryByRole("region", { name: "Completed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cancelled" })).not.toBeInTheDocument();
  });

  it("collapses and expands a status group while keeping its header visible", async () => {
    const user = userEvent.setup();
    routeFetch([issue({ id: "i1", title: "Fix leak", status: "open" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");

    const toggle = screen.getByRole("button", { name: /Todo/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Fix leak")).not.toBeInTheDocument();
    // Header (and count) stays visible so the group can be reopened.
    expect(screen.getByRole("region", { name: "Todo" })).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Fix leak")).toBeInTheDocument();
  });

  it("keeps create and priority filter controls in the tab toolbar (search moved to the header)", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("No work orders found.");
    expect(screen.getByRole("button", { name: "Create work order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Priority" })).toBeInTheDocument();
    // The search input no longer lives in the tab toolbar; it is in the header popover.
    expect(screen.queryByPlaceholderText("Search work orders...")).not.toBeInTheDocument();
  });

  it("filters the status queries by priority without hiding the groups", async () => {
    const user = userEvent.setup();
    routeFetch([issue({ id: "i1", title: "Fix leak", status: "open", priority: "urgent" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");

    await user.click(screen.getByRole("button", { name: "Priority" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Urgent" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("priority=urgent"))).toBe(true);
    });
    // The populated status group stays visible; filtering does not flatten the
    // grouped layout.
    expect(screen.getByRole("region", { name: "Todo" })).toBeInTheDocument();
    expect(screen.getByText("Fix leak")).toBeInTheDocument();
  });

  it("creates a work order through the compact composer", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    const members: ProjectMemberView[] = [{
      id: "m1",
      userId: "u1",
      displayName: null,
      roleId: "r1",
      title: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
    }];
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={members} userNames={new Map([["u1", "Alice"]])} />,
    );
    await screen.findByText("No work orders found.");

    // Toolbar button is the only "Create work order" control until the dialog opens.
    await user.click(screen.getByRole("button", { name: "Create work order" }));

    await user.type(await screen.findByPlaceholderText("Title"), "Replace pump seal");

    // Status pill defaults to Todo (open); switch to In Progress.
    await user.click(screen.getByRole("button", { name: /Todo/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "In Progress" }));

    // Priority pill defaults to Medium; pick High.
    await user.click(screen.getByRole("button", { name: /Medium/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "High" }));

    // Assignee pill: pick the project member.
    await user.click(screen.getByRole("button", { name: /Assignee/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Alice" }));

    // Due date: the native date input sits directly under a labeled pill, so the
    // calendar opens straight from the field with no intermediate menu to open.
    fireEvent.change(await screen.findByLabelText("Due date", { selector: "input" }), { target: { value: "2026-06-15" } });

    // Submit via the dialog's primary button (scope to avoid the toolbar twin).
    const dialog = screen.getByRole("dialog");
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

    // Dialog closes on success.
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
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
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
