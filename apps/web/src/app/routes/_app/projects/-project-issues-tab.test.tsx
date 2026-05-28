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

// The list issues one query honouring the q/status/priority params; the mock
// applies the same filters so assertions can target the resulting rows.
function routeFetch(issues: ProjectIssueRow[]) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const q = url.searchParams.get("q");
    let matched = issues;
    if (status)
      matched = matched.filter(i => i.status === status);
    if (priority)
      matched = matched.filter(i => i.priority === priority);
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
    expect(await screen.findByText("No issues found.")).toBeInTheDocument();
  });

  it("renders an issue row with status and priority badges and the unassigned marker", async () => {
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    const row = await screen.findByRole("row", { name: /Fix leak/ });
    expect(within(row).getByText("Fix leak")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("High")).toBeInTheDocument();
    expect(within(row).getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders a row with title, priority, assignee, and due date", async () => {
    routeFetch([issue({ id: "i1", title: "Fix leak", status: "open", priority: "urgent", assigneeMemberId: "m1", dueDate: "2026-06-15" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={[member()]} userNames={new Map([["u1", "Alice"]])} />);
    const row = await screen.findByRole("row", { name: /Fix leak/ });
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
    await user.type(screen.getByPlaceholderText("Search by title..."), "pump");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("q=pump"))).toBe(true);
    });
  });

  it("filters the query by status via the status dropdown", async () => {
    const user = userEvent.setup();
    routeFetch([issue({ status: "open" }), issue({ id: "i2", title: "Done item", status: "done" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Done" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("status=done"))).toBe(true);
    });
  });

  it("filters the query by priority via the priority dropdown", async () => {
    const user = userEvent.setup();
    routeFetch([issue({ priority: "urgent" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");

    await user.click(screen.getByRole("combobox", { name: "Priority" }));
    await user.click(await screen.findByRole("option", { name: "Urgent" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("priority=urgent"))).toBe(true);
    });
  });

  it("surfaces a load error", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "denied" } },
      { status: 403 },
    ));
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await waitFor(() => expect(screen.getByText("Failed to load data")).toBeInTheDocument());
  });

  it("creates a work order through the composer without sending a status", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={[member()]} userNames={new Map([["u1", "Alice"]])} />,
    );
    await screen.findByText("No issues found.");

    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText("Title"), "Replace pump seal");

    // Priority chip defaults to Medium; pick High.
    await user.click(within(dialog).getByRole("combobox", { name: "Priority" }));
    await user.click(await screen.findByRole("option", { name: "High" }));

    // Assignee chip: pick the project member.
    await user.click(within(dialog).getByRole("combobox", { name: "Assignee" }));
    await user.click(await screen.findByRole("option", { name: "Alice" }));

    // Due date: the native date input sits under an aria-hidden pill, so reach
    // it directly through the dialog container rather than by accessible label.
    const dateInput = dialog.querySelector("input[type=\"date\"]") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-06-15" } });

    await user.click(within(dialog).getByRole("button", { name: "Create Issue" }));

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
      expect("status" in body).toBe(false);
    });
  }, 15000);

  it("shows a roomy multi-line description field in the create dialog", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("No issues found.");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
    const description = await screen.findByLabelText("Description");
    expect(description.tagName).toBe("TEXTAREA");
    expect(Number(description.getAttribute("rows"))).toBeGreaterThanOrEqual(4);
  });

  it("deletes a row via the confirm dialog when the viewer can manage", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    const row = await screen.findByRole("row", { name: /Fix leak/ });
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""))!);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "DELETE");
      expect(del).toBeDefined();
      expect(String(del![0])).toContain("/projects/p1/issues/i1");
    });
  });

  it("pins an issue row via POST when the viewer can manage", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    const row = await screen.findByRole("row", { name: /Fix leak/ });
    await user.click(within(row).getByRole("button", { name: "Pin" }));
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
