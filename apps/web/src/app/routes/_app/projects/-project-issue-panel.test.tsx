import type { ProjectIssueRow, ProjectMemberView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ProjectIssuePanel } from "./-project-issue-panel";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: { id: "u1", role: "admin" } as never, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: false });
});

function issue(overrides: Partial<ProjectIssueRow> = {}): ProjectIssueRow {
  return {
    id: "i1",
    title: "Inspect hull",
    description: null,
    status: "todo",
    priority: "medium",
    creatorId: "u1",
    assigneeId: null,
    assigneeMemberId: null,
    projectId: "p1",
    dueDate: null,
    tags: [],
    pinned: false,
    pinnedAt: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function routeFetch(row: ProjectIssueRow, tagVocab: ReadonlyArray<{ id: string; name: string }> = []) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (/\/issues\/i1$/.test(path))
      return jsonResponse({ success: true, data: row });
    if (path.includes("/tags"))
      return jsonResponse({ success: true, data: tagVocab });
    // attachments, comments, limits — all empty.
    return jsonResponse({ success: true, data: [] });
  });
}

const noMembers: readonly ProjectMemberView[] = [];
const userNames = new Map([["u1", "Alice"]]);

describe("projectIssuePanel due date control", () => {
  it("shows a settable chevron affordance when the due date is unset", async () => {
    routeFetch(issue({ dueDate: null }));
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    const trigger = await screen.findByRole("button", { name: "Due Date" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain("Not set");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("shows the date plus a settable chevron affordance when the due date is set", async () => {
    routeFetch(issue({ dueDate: "2026-06-15" }));
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    const trigger = await screen.findByRole("button", { name: "Due Date" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain("2026-06-15");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });
});

describe("projectIssuePanel description surface", () => {
  it("renders the description block on a muted surface in readonly mode", async () => {
    routeFetch(issue({ description: "Check the keel" }));
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Inspect hull");
    expect(document.querySelector(".bg-muted\\/40")).not.toBeNull();
  });

  it("keeps the muted surface after entering edit mode", async () => {
    const user = userEvent.setup();
    routeFetch(issue({ description: "Check the keel" }));
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Inspect hull");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    // Edit branch (Cancel/Save) is active and still sits on the muted surface.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(document.querySelector(".bg-muted\\/40")).not.toBeNull();
  });
});

describe("projectIssuePanel tags", () => {
  it("renders the current issue tags", async () => {
    routeFetch(issue({ tags: [{ id: "t1", name: "hull" }] }), [{ id: "t1", name: "hull" }]);
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findAllByText("hull")).length).toBeGreaterThan(0);
  });

  it("persists a newly added tag via a PATCH to the issue", async () => {
    const user = userEvent.setup();
    routeFetch(issue({ tags: [] }), [{ id: "t1", name: "hull" }]);
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Inspect hull");
    await user.click(screen.getByText("Tags"));
    await user.click(await screen.findByRole("option", { name: "hull" }));

    await waitFor(() => {
      const patched = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patched).toBeDefined();
      const body = JSON.parse(String(patched?.[1]?.body)) as { tags?: string[] };
      expect(body.tags).toContain("hull");
    });
  });

  it("hides the tag editor for a read-only viewer but still shows chips", async () => {
    useAuthStore.setState({ user: { id: "u2", role: "member" } as never, loading: false });
    routeFetch(issue({ creatorId: "u1", tags: [{ id: "t1", name: "hull" }] }), [{ id: "t1", name: "hull" }]);
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage={false}
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("hull")).toBeInTheDocument();
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });
});

describe("projectIssuePanel sticky composer", () => {
  it("opts the comment composer into the bottom-pinned sticky layout", async () => {
    routeFetch(issue());
    renderWithProviders(
      <ProjectIssuePanel
        projectId="p1"
        issueId="i1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Inspect hull");
    await waitFor(() => expect(document.querySelector(".sticky.bottom-0")).not.toBeNull());
  });
});
