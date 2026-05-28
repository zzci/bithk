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

function routeFetch(issues: ProjectIssueRow[]) {
  fetchMock.mockImplementation(async () =>
    jsonResponse({ success: true, data: issues, meta: { total: issues.length, page: 1, limit: 20 } }));
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
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "denied" } },
      { status: 403 },
    ));
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await waitFor(() => expect(screen.getByText("Failed to load data")).toBeInTheDocument());
  });

  it("renders the status filter chips", async () => {
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByRole("button", { name: /All statuses/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /In Progress/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Done/ }).length).toBeGreaterThan(0);
  });

  it("toggles the status filter when a status chip is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    const all = await screen.findByRole("button", { name: /All statuses/ });
    const open = screen.getByRole("button", { name: /Open/ });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(open).toHaveAttribute("aria-pressed", "false");

    await user.click(open);
    expect(open).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    // The list re-queries scoped to the chosen status (limit 20 = main list).
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => {
        const u = String(c[0]);
        return u.includes("status=open") && u.includes("limit=20");
      })).toBe(true);
    });
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
  });

  it("switches to a status-based kanban view using existing issue statuses", async () => {
    const user = userEvent.setup();
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "open" }),
      issue({ id: "i2", title: "Align shaft", status: "in_progress" }),
      issue({ id: "i3", title: "Close report", status: "done" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await user.click(await screen.findByRole("button", { name: "Kanban view" }));
    expect(screen.getByText("Align shaft")).toBeInTheDocument();
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(screen.getByText("No work orders")).toBeInTheDocument();
  });
});
