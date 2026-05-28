import type { ProjectIssueRow, ProjectMemberView } from "@/shared/lib/api/projects";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectIssuesTab } from "./-project-issues-tab";

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
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
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

  it("debounces the search box into the issues query string", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("No work orders found.");
    await user.type(screen.getByPlaceholderText("Search work orders..."), "pump");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("q=pump"))).toBe(true);
    });
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

  it("renders a separate status group with its own count for each status", async () => {
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "open" }),
      issue({ id: "i2", title: "Align shaft", status: "open" }),
      issue({ id: "i3", title: "Close report", status: "in_progress" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);

    const openGroup = await screen.findByRole("region", { name: "Open" });
    expect(within(openGroup).getByText("2")).toBeInTheDocument();
    expect(within(openGroup).getByText("Fix leak")).toBeInTheDocument();
    expect(within(openGroup).getByText("Align shaft")).toBeInTheDocument();

    const inProgressGroup = screen.getByRole("region", { name: "In Progress" });
    expect(within(inProgressGroup).getByText("1")).toBeInTheDocument();
    expect(within(inProgressGroup).getByText("Close report")).toBeInTheDocument();

    // Empty statuses still appear as groups so the full picture stays visible.
    const doneGroup = screen.getByRole("region", { name: "Done" });
    expect(within(doneGroup).getByText("No work orders")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cancelled" })).toBeInTheDocument();
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

    // Priority pill defaults to Medium; pick High.
    await user.click(screen.getByRole("button", { name: /Medium/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "High" }));

    // Assignee pill: pick the project member.
    await user.click(screen.getByRole("button", { name: /Assignee/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Alice" }));

    // Due date pill: set the native date input then close the menu.
    await user.click(screen.getByRole("button", { name: /Due date/ }));
    // The base-ui menu popup also carries aria-label "Due date"; scope to the input.
    fireEvent.change(await screen.findByLabelText("Due date", { selector: "input" }), { target: { value: "2026-06-15" } });
    await user.keyboard("{Escape}");

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
        priority: "high",
        assigneeMemberId: "m1",
        dueDate: "2026-06-15",
      });
    });

    // Dialog closes on success.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }, 15000);

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
