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
    status: "todo",
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

  it("renders an issue row under its status section with the short id and unassigned avatar", async () => {
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    expect(await screen.findByText("Fix leak")).toBeInTheDocument();
    // `todo` is grouped under the product label "To Do".
    expect(screen.getByRole("region", { name: "To Do" })).toBeInTheDocument();
    // Short id is shown; priority + assignee are icon/avatar with accessible titles.
    expect(screen.getByText("i1")).toBeInTheDocument();
    expect(screen.getByTitle("High")).toBeInTheDocument();
    expect(screen.getByTitle("Unassigned")).toBeInTheDocument();
  });

  it("renders a row with title, priority signal, due date, and assignee avatar", async () => {
    routeFetch([issue({ priority: "urgent", assigneeMemberId: "m1", dueDate: "2099-06-15" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={[member()]} userNames={new Map([["u1", "Alice"]])} />);
    const row = await screen.findByRole("button", { name: /Fix leak/ });
    expect(within(row).getByText("Fix leak")).toBeInTheDocument();
    expect(within(row).getByTitle("Urgent")).toBeInTheDocument();
    // Assignee avatar carries the member label as its title; due date keeps the
    // raw value as a title while showing a relative label.
    expect(within(row).getByTitle("Alice")).toBeInTheDocument();
    expect(within(row).getByTitle("2099-06-15")).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText("Search work orders...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create work order" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Priority" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All priorities" })).not.toBeInTheDocument();
  });

  it("filters the list when a top status filter chip is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "todo" }),
      issue({ id: "i2", title: "Close report", status: "done" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByText("Close report")).toBeInTheDocument();

    const filterGroup = screen.getByRole("group", { name: "Filter by status" });
    await user.click(within(filterGroup).getByRole("button", { name: /Done/ }));

    expect(screen.getByText("Close report")).toBeInTheDocument();
    expect(screen.queryByText("Fix leak")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "To Do" })).not.toBeInTheDocument();
  });

  it("filters by status when a section header is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "todo" }),
      issue({ id: "i2", title: "Mid task", status: "working" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByRole("region", { name: "In Progress" })).toBeInTheDocument();

    const todoRegion = screen.getByRole("region", { name: "To Do" });
    // The section header's filter control carries the exact status label.
    await user.click(within(todoRegion).getByRole("button", { name: "To Do" }));

    expect(screen.getByText("Fix leak")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "In Progress" })).not.toBeInTheDocument();
    expect(screen.queryByText("Mid task")).not.toBeInTheDocument();
  });

  it("collapses a section's rows while keeping its header visible", async () => {
    const user = userEvent.setup();
    routeFetch([issue({ status: "todo", title: "Fix leak" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");

    const todoRegion = screen.getByRole("region", { name: "To Do" });
    const chevron = within(todoRegion).getByRole("button", { name: "Toggle section" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");

    await user.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Fix leak")).not.toBeInTheDocument();
    // Header stays so the section can be reopened.
    expect(screen.getByRole("region", { name: "To Do" })).toBeInTheDocument();
  });

  it("renders a separate status section with its own count for populated statuses only", async () => {
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "todo" }),
      issue({ id: "i2", title: "Align shaft", status: "todo" }),
      issue({ id: "i3", title: "Close report", status: "working" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);

    const openGroup = await screen.findByRole("region", { name: "To Do" });
    expect(within(openGroup).getByText("2")).toBeInTheDocument();
    expect(within(openGroup).getByText("Fix leak")).toBeInTheDocument();
    expect(within(openGroup).getByText("Align shaft")).toBeInTheDocument();

    const inProgressGroup = screen.getByRole("region", { name: "In Progress" });
    expect(within(inProgressGroup).getByText("1")).toBeInTheDocument();
    expect(within(inProgressGroup).getByText("Close report")).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Done" })).not.toBeInTheDocument();
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

    await user.click(within(dialog).getByRole("button", { name: /To Do/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "In Progress" }));

    await user.click(within(dialog).getByRole("button", { name: /Medium/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "High" }));

    await user.click(within(dialog).getByRole("button", { name: /Assignee/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Alice" }));

    fireEvent.change(within(dialog).getByLabelText("Due date", { selector: "input" }), { target: { value: "2099-06-15" } });

    await user.click(within(dialog).getByRole("button", { name: "Create work order" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
      expect(String(post![0])).toContain("/projects/p1/issues");
      const body = JSON.parse(String(post![1]!.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        title: "Replace pump seal",
        status: "working",
        priority: "high",
        assigneeMemberId: "m1",
        dueDate: "2099-06-15",
      });
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }, 15000);

  it("opens the composer pre-set to a status via the section quick-create", async () => {
    const user = userEvent.setup();
    routeFetch([issue({ id: "i9", title: "Done thing", status: "done" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Done thing");

    const doneRegion = screen.getByRole("region", { name: "Done" });
    await user.click(within(doneRegion).getByRole("button", { name: "New Done work order" }));

    const dialog = await screen.findByRole("dialog");
    // Status pill is pre-set to the section's status.
    expect(within(dialog).getByRole("button", { name: /Done/ })).toBeInTheDocument();

    await user.type(within(dialog).getByPlaceholderText("Title"), "Another done item");
    await user.click(within(dialog).getByRole("button", { name: "Create work order" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ title: "Another done item", status: "done" });
    });
  }, 15000);

  it("opens the native date picker when the due-date pill is clicked", async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    const original = (HTMLInputElement.prototype as { showPicker?: (() => void) | undefined }).showPicker;
    (HTMLInputElement.prototype as { showPicker?: (() => void) | undefined }).showPicker = showPicker;
    try {
      routeFetch([]);
      renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
      await screen.findByText("No work orders found.");
      await user.click(screen.getByRole("button", { name: "Create work order" }));
      const dialog = await screen.findByRole("dialog");

      await user.click(within(dialog).getByRole("button", { name: "Due date" }));
      expect(showPicker).toHaveBeenCalledTimes(1);
    }
    finally {
      (HTMLInputElement.prototype as { showPicker?: (() => void) | undefined }).showPicker = original;
    }
  });

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
