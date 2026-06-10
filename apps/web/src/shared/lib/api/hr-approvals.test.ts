import type { HrApprovalRow } from "./hr-approvals";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  HR_APPROVAL_STATUSES,
  HR_APPROVAL_TYPES,
  hrApprovalKeys,
  useCreateHrApproval,
  useDecideHrApproval,
  useDeleteHrApproval,
  useHrApprovals,
  useUpdateHrApproval,
} from "./hr-approvals";

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

function row(overrides: Partial<HrApprovalRow> = {}): HrApprovalRow {
  return {
    id: "ap1",
    colleagueId: "fc1",
    type: "leave",
    title: "Annual leave",
    reason: null,
    status: "pending",
    decisionNote: null,
    decidedAt: null,
    decidedByName: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    applicant: { name: "Alice", username: "alice", isVirtual: false },
    ...overrides,
  };
}

describe("hrApprovalKeys", () => {
  it("namespaces list keys deterministically", () => {
    expect(hrApprovalKeys.all).toEqual(["hr", "approvals"]);
    expect(hrApprovalKeys.list("status=pending&page=1&limit=20")).toEqual([
      "hr",
      "approvals",
      "list",
      "status=pending&page=1&limit=20",
    ]);
  });
});

describe("approval enums", () => {
  it("cover the request lifecycle and types", () => {
    expect(HR_APPROVAL_STATUSES).toEqual(["pending", "approved", "rejected"]);
    expect(HR_APPROVAL_TYPES).toEqual(["leave", "overtime", "business_trip", "other"]);
  });
});

describe("useHrApprovals", () => {
  it("requests the default first page and unwraps data + meta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [row()],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }));
    const { result } = renderHook(() => useHrApprovals(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.meta.total).toBe(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/hr/approvals?");
    expect(url).toContain("page=1");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("type=");
  });

  it("encodes search, status, and type filters into the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [],
      meta: { total: 0, page: 2, limit: 50, totalPages: 0 },
    }));
    const { result } = renderHook(
      () => useHrApprovals({ q: "leave", status: "approved", type: "overtime", page: 2, limit: 50 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("q=leave");
    expect(url).toContain("status=approved");
    expect(url).toContain("type=overtime");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=50");
  });

  it("surfaces a 403 as an error without retrying", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "no access" } },
      { status: 403 },
    ));
    const { result } = renderHook(() => useHrApprovals(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("hr approval mutations", () => {
  it("creates a request via POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row() }, { status: 201 }));
    const { result } = renderHook(() => useCreateHrApproval(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ colleagueId: "fc1", type: "leave", title: "Annual leave" });
    expect(created.status).toBe("pending");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/approvals");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ colleagueId: "fc1", type: "leave", title: "Annual leave" });
  });

  it("patches a pending request, encoding the id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ title: "Sick leave" }) }));
    const { result } = renderHook(() => useUpdateHrApproval(), { wrapper: makeWrapper() });
    const updated = await result.current.mutateAsync({ id: "ap 1", title: "Sick leave" });
    expect(updated.title).toBe("Sick leave");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/approvals/ap%201");
    expect(init?.method).toBe("PATCH");
  });

  it("decides a request via the decision endpoint and keeps the decider data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: row({ status: "approved", decidedByName: "Admin", decidedAt: "2026-06-10T01:00:00.000Z", decisionNote: "OK" }),
    }));
    const { result } = renderHook(() => useDecideHrApproval(), { wrapper: makeWrapper() });
    const decided = await result.current.mutateAsync({ id: "ap1", status: "approved", note: "OK" });
    expect(decided.status).toBe("approved");
    expect(decided.decidedByName).toBe("Admin");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/approvals/ap1/decision");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "approved", note: "OK" });
  });

  it("surfaces the 409 message when a request was already decided", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "APPROVAL_DECIDED", message: "Approval has already been decided" } },
      { status: 409 },
    ));
    const { result } = renderHook(() => useDecideHrApproval(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync({ id: "ap1", status: "rejected" }))
      .rejects
      .toThrow("Approval has already been decided");
  });

  it("withdraws a pending request via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const { result } = renderHook(() => useDeleteHrApproval(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("ap1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/approvals/ap1");
    expect(init?.method).toBe("DELETE");
  });
});
