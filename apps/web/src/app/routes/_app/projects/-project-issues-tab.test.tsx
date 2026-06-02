import type { ProjectIssueRow, ProjectMemberView, ProjectTag } from "@/shared/lib/api/projects";
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
    tags: [],
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
// query param and returns only the matching issues (with a matching total). The
// selectable issue-tag vocabulary is served from `/tags`, and repeatable
// `tagIds` params narrow the list to the union of the selected tags.
function routeFetch(issues: ProjectIssueRow[], issueTags: ProjectTag[] = []) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/tags"))
      return jsonResponse({ success: true, data: issueTags });
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    const tagIds = url.searchParams.getAll("tagIds");
    let matched = status ? issues.filter(i => i.status === status) : issues;
    if (q)
      matched = matched.filter(i => i.title.toLowerCase().includes(q.toLowerCase()));
    if (tagIds.length > 0)
      matched = matched.filter(i => i.tags.some(tag => tagIds.includes(tag.id)));
    return jsonResponse({ success: true, data: matched, meta: { total: matched.length, page: 1, limit: 20 } });
  });
}

// Issue-tag vocabulary, most-used first; ids are 1-based (`t1`, `t2`, ...).
function tags(...names: string[]): ProjectTag[] {
  return names.map((name, i) => ({ id: `t${i + 1}`, name, usageCount: names.length - i }));
}

// jsdom does no layout, so offsetWidth/clientWidth are 0 by default. Override
// clientWidth on the container to simulate a wide row where every chip fits.
function withWideContainer(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  return () => {
    if (original)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  };
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
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />);
    await screen.findByText("No work orders found.");
    expect(screen.getByPlaceholderText("Search work orders...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Priority" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All priorities" })).not.toBeInTheDocument();
  });

  it("lays out the tag filter on the left and search + create grouped on the right of one toolbar row", async () => {
    const restore = withWideContainer();
    routeFetch([issue({ tags: [{ id: "t1", name: "electrical" }] })], tags("electrical"));
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />);
    await screen.findByText("Fix leak");

    // Tag vocabulary loads asynchronously; wait for the filter group + its label.
    const tagFilter = await screen.findByRole("group", { name: "Filter by tag" });
    // The tag filter shows a visible label so users know what the chips do.
    expect(within(tagFilter).getByText("Filter by tag")).toBeInTheDocument();
    const search = screen.getByPlaceholderText("Search work orders...");
    const create = screen.getByRole("button", { name: "New" });

    // Search + create share a right-side group that excludes the tag filter.
    const rightGroup = create.parentElement!;
    expect(rightGroup).toContainElement(search);
    expect(rightGroup).not.toContainElement(tagFilter);

    // The toolbar row holds the tag filter and the right group as adjacent siblings.
    const toolbar = rightGroup.parentElement!;
    expect(toolbar).toContainElement(tagFilter);
    expect(tagFilter.nextElementSibling).toBe(rightGroup);
    restore();
  });

  it("no longer renders the status-filter chip row", async () => {
    routeFetch([issue({ status: "todo" })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.queryByRole("group", { name: "Filter by status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All statuses/i })).not.toBeInTheDocument();
    // Every populated status group still renders (grouping is preserved).
    expect(screen.getByRole("region", { name: "To Do" })).toBeInTheDocument();
  });

  it("renders all populated status groups including the review group", async () => {
    routeFetch([
      issue({ id: "i1", title: "Fix leak", status: "todo" }),
      issue({ id: "i2", title: "In review item", status: "review" }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByRole("region", { name: "In Review" })).toBeInTheDocument();
    expect(screen.getByText("In review item")).toBeInTheDocument();
  });

  it("renders an assigned tag chip on its issue row", async () => {
    routeFetch([issue({ tags: [{ id: "t1", name: "electrical" }] })]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    const row = await screen.findByRole("button", { name: /Fix leak/ });
    expect(within(row).getByText("electrical")).toBeInTheDocument();
  });

  // A stale-cache / contract-violating row genuinely lacks the `tags` key.
  function taglessIssue(overrides: Partial<ProjectIssueRow> = {}): ProjectIssueRow {
    const { tags: _tags, ...rest } = issue(overrides);
    return rest as unknown as ProjectIssueRow;
  }

  it("renders a row without throwing when its tags are missing", async () => {
    // Reproduces the prod crash: a row whose `tags` is undefined must not throw
    // at `tags.length` / `tags.slice`.
    routeFetch([taglessIssue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    const row = await screen.findByRole("button", { name: /Fix leak/ });
    expect(within(row).getByText("Fix leak")).toBeInTheDocument();
    // No tag chip is rendered for the tag-less row.
    expect(within(row).queryByText("electrical")).not.toBeInTheDocument();
  });

  it("renders a mixed list of tag-less and tagged rows without throwing", async () => {
    routeFetch([
      taglessIssue({ id: "i1", title: "Fix leak", status: "todo" }),
      issue({ id: "i2", title: "Wire panel", status: "todo", tags: [{ id: "t1", name: "electrical" }] }),
    ]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    const taggedRow = await screen.findByRole("button", { name: /Wire panel/ });
    expect(within(taggedRow).getByText("electrical")).toBeInTheDocument();
    // The tag-less row renders alongside it, with no chip of its own.
    const taglessRow = screen.getByRole("button", { name: /Fix leak/ });
    expect(within(taglessRow).queryByText("electrical")).not.toBeInTheDocument();
  });

  it("toggles a tag in the multi-select bar and threads tagIds into the issues query", async () => {
    const user = userEvent.setup();
    const restore = withWideContainer();
    try {
      routeFetch(
        [
          issue({ id: "i1", title: "Fix leak", status: "todo", tags: [{ id: "t1", name: "alpha" }] }),
          issue({ id: "i2", title: "Other task", status: "todo", tags: [{ id: "t2", name: "beta" }] }),
        ],
        tags("alpha", "beta"),
      );
      renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
      await screen.findByText("Fix leak");
      expect(screen.getByText("Other task")).toBeInTheDocument();

      const bar = screen.getByRole("group", { name: "Filter by tag" });
      const alphaChip = within(bar).getByRole("button", { name: "alpha" });
      await user.click(alphaChip);

      // The selected chip is marked pressed and tagIds reaches the single
      // issues query (one repeatable param per tag id).
      expect(alphaChip).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(c => String(c[0]).includes("tagIds=t1") && String(c[0]).includes("/issues"))).toBe(true);
      });
      // Union filter narrows the list to issues carrying the selected tag.
      await waitFor(() => expect(screen.queryByText("Other task")).not.toBeInTheDocument());
      expect(screen.getByText("Fix leak")).toBeInTheDocument();

      // Deselecting clears the filter.
      await user.click(within(bar).getByRole("button", { name: "alpha" }));
      await waitFor(() => expect(screen.getByText("Other task")).toBeInTheDocument());
    }
    finally {
      restore();
    }
  });

  it("opens a searchable More combobox for overflow tags and toggles via it", async () => {
    const user = userEvent.setup();
    // Default jsdom clientWidth (0) forces all-but-one tag into the overflow.
    routeFetch(
      [issue({ id: "i1", title: "Fix leak", status: "todo", tags: [{ id: "t3", name: "gamma" }] })],
      tags("alpha", "beta", "gamma"),
    );
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />);
    await screen.findByText("Fix leak");

    const more = screen.getByRole("combobox", { name: "More tags" });
    await user.click(more);
    const search = await screen.findByPlaceholderText("Search tags");
    await user.type(search, "gamma");
    await user.click(await screen.findByRole("option", { name: "gamma" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("tagIds=t3"))).toBe(true);
    });
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
      <ProjectIssuesTab projectId="p1" members={[member()]} userNames={new Map([["u1", "Alice"]])} canManage />,
    );
    await screen.findByText("No work orders found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByPlaceholderText("Issue title"), "Replace pump seal");

    await user.click(within(dialog).getByRole("button", { name: /To Do/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "In Progress" }));

    await user.click(within(dialog).getByRole("button", { name: /Medium/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "High" }));

    await user.click(within(dialog).getByRole("button", { name: /Assignee/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Alice" }));

    fireEvent.change(within(dialog).getByLabelText("Due date", { selector: "input" }), { target: { value: "2099-06-15" } });

    await user.click(within(dialog).getByRole("button", { name: "Create issue" }));

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

  it("keeps the composer open and resets the form when 'create more' is on", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(
      <ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("No work orders found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("switch", { name: "Create more" }));
    const titleInput = within(dialog).getByPlaceholderText("Issue title");
    await user.type(titleInput, "First issue");
    await user.click(within(dialog).getByRole("button", { name: "Create issue" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
    });

    // Dialog stays open and the title clears, ready for the next entry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByPlaceholderText("Issue title")).toHaveValue(""));
  }, 15000);

  it("opens the native date picker when the due-date pill is clicked", async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    const original = (HTMLInputElement.prototype as { showPicker?: (() => void) | undefined }).showPicker;
    (HTMLInputElement.prototype as { showPicker?: (() => void) | undefined }).showPicker = showPicker;
    try {
      routeFetch([]);
      renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />);
      await screen.findByText("No work orders found.");
      await user.click(screen.getByRole("button", { name: "New" }));
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
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} canManage />);
    await screen.findByText("No work orders found.");
    await user.click(screen.getByRole("button", { name: "New" }));
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
