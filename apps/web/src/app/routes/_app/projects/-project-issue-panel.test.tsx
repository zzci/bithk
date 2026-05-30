import type { ProjectIssueRow, ProjectMemberView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
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

function routeFetch(row: ProjectIssueRow) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (/\/issues\/i1$/.test(path))
      return jsonResponse({ success: true, data: row });
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
