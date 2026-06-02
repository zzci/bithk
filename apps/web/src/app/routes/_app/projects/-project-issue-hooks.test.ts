import type { QueryClient } from "@tanstack/react-query";
import type { ProjectIssueRow } from "@/shared/lib/api/projects";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestQueryClient, makeWrapper } from "@/test/utils";
import { useDeleteProjectIssue, useProjectIssue, useUpdateProjectIssue } from "./-project-issue-hooks";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

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
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

const ISSUE_KEY = ["projects", "p1", "issue", "i1"] as const;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("useProjectIssue", () => {
  it("fetches a single issue and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: issue() }));

    const { result } = renderHook(() => useProjectIssue("p1", "i1"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("i1");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/projects/p1/issues/i1");
  });

  it("stays disabled while ids are missing", () => {
    const { result } = renderHook(() => useProjectIssue(undefined, undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useUpdateProjectIssue", () => {
  it("writes the updated issue into the per-issue cache and invalidates the list", async () => {
    const updated = issue({ title: "Inspect hull thoroughly" });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: updated }));

    const queryClient: QueryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProjectIssue(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ projectId: "p1", issueId: "i1", title: "Inspect hull thoroughly" });

    expect(queryClient.getQueryData(ISSUE_KEY)).toEqual(updated);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects", "p1", "issues"] });
  });
});

describe("useDeleteProjectIssue", () => {
  it("removes the per-issue cache entry and invalidates the list keys", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));

    const queryClient: QueryClient = makeTestQueryClient();
    queryClient.setQueryData(ISSUE_KEY, issue());
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteProjectIssue(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ projectId: "p1", issueId: "i1" });

    expect(queryClient.getQueryData(ISSUE_KEY)).toBeUndefined();
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ISSUE_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects", "p1", "issues"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects", "p1", "issues", ""] });
  });
});
