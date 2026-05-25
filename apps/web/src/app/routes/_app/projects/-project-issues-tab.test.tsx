import type { ProjectIssueRow } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
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

  it("renders the summary strip with the four status tiles", async () => {
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    await screen.findByText("Fix leak");
    expect(screen.getByRole("button", { name: /Total work orders/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pending/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /In progress/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Done/ }).length).toBeGreaterThan(0);
  });

  it("toggles the status filter when a summary tile is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([issue()]);
    renderWithProviders(<ProjectIssuesTab projectId="p1" members={noMembers} userNames={new Map()} />);
    const total = await screen.findByRole("button", { name: /Total work orders/ });
    const pending = screen.getByRole("button", { name: /Pending/ });
    expect(total).toHaveAttribute("aria-pressed", "true");
    expect(pending).toHaveAttribute("aria-pressed", "false");

    await user.click(pending);
    expect(pending).toHaveAttribute("aria-pressed", "true");
    expect(total).toHaveAttribute("aria-pressed", "false");
    // The list re-queries scoped to the chosen status (limit 20 = main list).
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => {
        const u = String(c[0]);
        return u.includes("status=open") && u.includes("limit=20");
      })).toBe(true);
    });
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
