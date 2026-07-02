import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestQueryClient, makeWrapper } from "@/test/utils";
import {
  policyKeys,
  useCheckPermission,
  useCreateTuple,
  useDeleteTuple,
  useEntities,
  usePolicyTuples,
  useRemoveResourceGroupMember,
  useResourceGroupMembers,
  useResourceGroups,
  useUpdateTuple,
} from "./policy";

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
});

afterEach(() => {
  fetchMock.mockReset();
});

function calledUrl(index = 0): string {
  return String(fetchMock.mock.calls[index]![0]);
}

describe("policyKeys", () => {
  it("nests tuples and resource-group keys under their roots", () => {
    expect(policyKeys.tuples("group", 2)).toEqual(["policy", "tuples", "group", 2]);
    expect(policyKeys.tuplesRoot).toEqual(["policy", "tuples"]);
    expect(policyKeys.resourceGroupMembers("rg1")).toEqual(["policy", "resource-groups", "rg1", "members"]);
  });
});

describe("useEntities", () => {
  it("fetches the entity catalog", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { group: [] } }));
    const { result } = renderHook(() => useEntities(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe("/api/policy/entities");
  });
});

describe("usePolicyTuples", () => {
  it("omits the namespace filter when unset and defaults pagination", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, limit: 20 } }));
    const { result } = renderHook(() => usePolicyTuples(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("/policy/tuples?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("namespace=");
  });

  it("serialises the namespace and page", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], meta: { total: 0, page: 3, limit: 20 } }));
    const { result } = renderHook(() => usePolicyTuples({ namespace: "group", page: 3 }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("namespace=group");
    expect(url).toContain("page=3");
  });
});

describe("tuple mutations", () => {
  it("creates a tuple via POST and invalidates the tuples root", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "t1" } }));
    const queryClient: QueryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateTuple(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({
      namespace: "group",
      objectId: "g1",
      relation: "member",
      subjectNamespace: "user",
      subjectId: "u1",
      subjectRelation: null,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/policy/tuples");
    expect(init?.method).toBe("POST");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: policyKeys.tuplesRoot });
  });

  it("updates a tuple relation via PATCH", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "t1" } }));
    const { result } = renderHook(() => useUpdateTuple(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ id: "t1", relation: "viewer" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/policy/tuples/t1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ relation: "viewer" });
  });

  it("deletes a tuple via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteTuple(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("t1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/policy/tuples/t1");
    expect(init?.method).toBe("DELETE");
  });
});

describe("useCheckPermission", () => {
  it("pOSTs the check request and returns the verdict", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { allowed: true, resolvedThrough: [] } }));
    const { result } = renderHook(() => useCheckPermission(), { wrapper: makeWrapper() });
    const res = await result.current.mutateAsync({
      namespace: "group",
      objectId: "g1",
      relation: "member",
      subjectNamespace: "user",
      subjectId: "u1",
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/policy/check");
    expect(res.data.allowed).toBe(true);
  });
});

describe("resource groups", () => {
  it("lists groups and members from their endpoints", async () => {
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: [] }));
    const groups = renderHook(() => useResourceGroups(), { wrapper: makeWrapper() });
    await waitFor(() => expect(groups.result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe("/api/policy/resource-groups");

    const members = renderHook(() => useResourceGroupMembers("rg1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(members.result.current.isSuccess).toBe(true));
    expect(calledUrl(1)).toBe("/api/policy/resource-groups/rg1/members");
  });

  it("removes a member via DELETE and invalidates the member list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const queryClient: QueryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRemoveResourceGroupMember("rg1"), { wrapper: makeWrapper(queryClient) });
    await result.current.mutateAsync("tuple1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/policy/resource-groups/rg1/members/tuple1");
    expect(init?.method).toBe("DELETE");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: policyKeys.resourceGroupMembers("rg1") });
  });
});
