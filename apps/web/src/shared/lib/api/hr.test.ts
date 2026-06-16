import type { HrColleagueRow } from "./hr";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  HR_COLLEAGUE_STATUSES,
  hrColleagueKeys,
  useArchiveHrColleague,
  useCreateHrColleague,
  useHrColleagues,
  useUpdateHrColleague,
} from "./hr";

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

function row(overrides: Partial<HrColleagueRow> = {}): HrColleagueRow {
  return {
    id: "fc1",
    userId: "u1",
    code: "F-001",
    title: "Accountant",
    department: "Finance",
    status: "active",
    notes: null,
    birthday: null,
    hireDate: null,
    probationEndDate: null,
    contractEndDate: null,
    gender: null,
    employmentType: null,
    nationality: null,
    personalPhone: null,
    personalEmail: null,
    address: null,
    workLocation: null,
    salaryAmount: null,
    salaryCurrency: null,
    paymentInfo: [],
    emergencyContacts: [],
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    user: { name: "Alice", username: "alice", isVirtual: false, status: "active" },
    ...overrides,
  };
}

describe("hrColleagueKeys", () => {
  it("namespaces list keys deterministically", () => {
    expect(hrColleagueKeys.all).toEqual(["hr", "colleagues"]);
    expect(hrColleagueKeys.list("status=active&page=1&limit=20")).toEqual([
      "hr",
      "colleagues",
      "list",
      "status=active&page=1&limit=20",
    ]);
  });
});

describe("fINANCE_COLLEAGUE_STATUSES", () => {
  it("covers the active and archived lifecycle states", () => {
    expect(HR_COLLEAGUE_STATUSES).toEqual(["active", "archived"]);
  });
});

describe("useHrColleagues", () => {
  it("requests the default first page and unwraps data + meta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [row()],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }));
    const { result } = renderHook(() => useHrColleagues(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.meta.total).toBe(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/hr/colleagues?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("q=");
  });

  it("keeps the joined user data (real vs virtual) on each row", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [
        row(),
        row({ id: "fc2", userId: "u2", user: { name: "Crew B", username: "crew-b", isVirtual: true, status: "active" } }),
      ],
      meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
    }));
    const { result } = renderHook(() => useHrColleagues(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.user.isVirtual).toBe(false);
    expect(result.current.data?.data[1]?.user.isVirtual).toBe(true);
    expect(result.current.data?.data[1]?.user.username).toBe("crew-b");
  });

  it("encodes search, status and pagination filters into the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [],
      meta: { total: 0, page: 2, limit: 50, totalPages: 0 },
    }));
    const { result } = renderHook(
      () => useHrColleagues({ q: "ali", status: "archived", page: 2, limit: 50 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("q=ali");
    expect(url).toContain("status=archived");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=50");
  });

  it("surfaces a 403 as an error without retrying", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "no access" } },
      { status: 403 },
    ));
    const { result } = renderHook(() => useHrColleagues(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("hr colleague mutations", () => {
  it("creates a colleague linked to a real user via POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row() }, { status: 201 }));
    const { result } = renderHook(() => useCreateHrColleague(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ userId: "u1", code: "F-001" });
    expect(created.user.isVirtual).toBe(false);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/colleagues");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ userId: "u1", code: "F-001" });
  });

  it("creates a colleague linked to a virtual user via POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: row({ userId: "u2", user: { name: "Crew B", username: "crew-b", isVirtual: true, status: "active" } }),
    }, { status: 201 }));
    const { result } = renderHook(() => useCreateHrColleague(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ userId: "u2", department: "Ops" });
    expect(created.user.isVirtual).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ userId: "u2", department: "Ops" });
  });

  it("rejects a duplicate user link with the server conflict message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "CONFLICT", message: "User is already an HR colleague" } },
      { status: 409 },
    ));
    const { result } = renderHook(() => useCreateHrColleague(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync({ userId: "u1" }))
      .rejects
      .toThrow("User is already an HR colleague");
  });

  it("patches a colleague, encoding the id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ title: "Lead" }) }));
    const { result } = renderHook(() => useUpdateHrColleague(), { wrapper: makeWrapper() });
    const updated = await result.current.mutateAsync({ id: "fc 1", title: "Lead", status: "active" });
    expect(updated.title).toBe("Lead");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/colleagues/fc%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Lead", status: "active" });
  });

  it("archives a colleague via DELETE and returns the archived row", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ status: "archived" }) }));
    const { result } = renderHook(() => useArchiveHrColleague(), { wrapper: makeWrapper() });
    const archived = await result.current.mutateAsync("fc1");
    expect(archived.status).toBe("archived");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/colleagues/fc1");
    expect(init?.method).toBe("DELETE");
  });
});
