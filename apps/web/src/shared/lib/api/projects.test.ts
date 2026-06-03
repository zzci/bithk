import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  projectKeys,
  useAddProjectMember,
  useCreateProcurementCategory,
  useCreateProject,
  useCreateProjectIssue,
  useCreateProjectRole,
  useDeleteProject,
  useProject,
  useProjectIssues,
  useProjectMembers,
  useProjectRoles,
  useProjects,
  useTags,
  useUpdateProject,
} from "./projects";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();
const listEnvelope = { success: true, data: [], meta: { total: 0, page: 1, limit: 20 } };

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function calledUrl(index = 0): string {
  return String(fetchMock.mock.calls[index]![0]);
}

describe("projectKeys", () => {
  it("builds stable list and detail keys", () => {
    expect(projectKeys.list("active", "t1", "atlas", 2, 20)).toEqual(["projects", "list", "active", "t1", "atlas", 2, 20]);
    expect(projectKeys.detail("p1")).toEqual(["projects", "detail", "p1"]);
  });
});

describe("useTags", () => {
  it("fetches the tag list and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ id: "t1", name: "infra" }] }));
    const { result } = renderHook(() => useTags(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "t1", name: "infra" }]);
    expect(calledUrl()).toBe("/api/tags");
  });
});

describe("useProjects", () => {
  it("omits absent filters and defaults pagination", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(() => useProjects(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("tagIds=");
    expect(url).not.toContain("q=");
  });

  it("serialises status, tag and search filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(
      () => useProjects({ status: "archived", q: "atlas", tagIds: ["t9"], page: 2, limit: 10 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("status=archived");
    expect(url).toContain("q=atlas");
    expect(url).toContain("tagIds=t9");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=10");
  });

  it("appends each selected tag as a repeatable, sorted tagIds param", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(
      () => useProjects({ tagIds: ["t9", "t2"] }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    // Both ids surface as separate repeatable params, sorted for a stable key.
    expect(url).toContain("tagIds=t2");
    expect(url).toContain("tagIds=t9");
    expect(url.indexOf("tagIds=t2")).toBeLessThan(url.indexOf("tagIds=t9"));
    // The legacy single-tag param is gone.
    expect(url).not.toContain("tagId=");
  });

  it("sends no tagIds param when the selection is empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(() => useProjects({ tagIds: [] }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).not.toContain("tagIds=");
  });
});

describe("useProject", () => {
  it("does not fetch without an id", () => {
    const { result } = renderHook(() => useProject(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and url-encodes the id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "p 1", name: "Tower" } }));
    const { result } = renderHook(() => useProject("p 1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe("/api/projects/p%201");
  });
});

describe("useProjectIssues", () => {
  it("includes only the filters that are set", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(
      () => useProjectIssues("p1", { q: "leak", status: "todo", priority: "high" }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("q=leak");
    expect(url).toContain("status=todo");
    expect(url).toContain("priority=high");
  });

  it("falls back to page/limit defaults with no filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(() => useProjectIssues("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("q=");
  });
});

describe("project role + member queries", () => {
  it("fetches roles for a project", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const { result } = renderHook(() => useProjectRoles("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe("/api/projects/p1/roles");
  });

  it("fetches members for a project", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const { result } = renderHook(() => useProjectMembers("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe("/api/projects/p1/members");
  });
});

describe("project mutations", () => {
  it("creates a project via POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "p1", name: "New" } }));
    const { result } = renderHook(() => useCreateProject(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ name: "New" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects");
    expect(init?.method).toBe("POST");
  });

  it("updates a project via PATCH", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "p1", name: "Renamed" } }));
    const { result } = renderHook(() => useUpdateProject(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ id: "p1", name: "Renamed" });
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("PATCH");
  });

  it("deletes a project via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteProject(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("p1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/p1");
    expect(init?.method).toBe("DELETE");
  });

  it("adds a member, creates a role, a category and an issue", async () => {
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: { id: "x" } }));
    const member = renderHook(() => useAddProjectMember(), { wrapper: makeWrapper() });
    await member.result.current.mutateAsync({ projectId: "p1", roleId: "r1" });
    const role = renderHook(() => useCreateProjectRole(), { wrapper: makeWrapper() });
    await role.result.current.mutateAsync({ projectId: "p1", name: "Lead" });
    const category = renderHook(() => useCreateProcurementCategory(), { wrapper: makeWrapper() });
    await category.result.current.mutateAsync({ projectId: "p1", name: "Tools" });
    const issue = renderHook(() => useCreateProjectIssue(), { wrapper: makeWrapper() });
    await issue.result.current.mutateAsync({ projectId: "p1", title: "Bug" });
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      "/api/projects/p1/members",
      "/api/projects/p1/roles",
      "/api/projects/p1/procurement-categories",
      "/api/projects/p1/issues",
    ]);
  });

  it("propagates a server error on create", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "CONFLICT", message: "duplicate name" } },
      { status: 409 },
    ));
    const { result } = renderHook(() => useCreateProject(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync({ name: "dup" })).rejects.toThrow("duplicate name");
  });
});
