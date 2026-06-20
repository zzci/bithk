import type { HrPayrollRow } from "./hr-payroll";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  HR_PAYROLL_STATUSES,
  hrPayrollKeys,
  useCreateHrPayrollRecord,
  useDeleteHrPayrollRecord,
  useGeneratePayroll,
  useHrPayrollRecords,
  useUpdateHrPayrollRecord,
} from "./hr-payroll";

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

function row(overrides: Partial<HrPayrollRow> = {}): HrPayrollRow {
  return {
    id: "pr1",
    colleagueId: "fc1",
    period: "2026-06",
    baseSalary: 100000,
    bonus: 5000,
    deduction: 2000,
    currency: "CNY",
    netAmount: 103000,
    status: "pending",
    paidAt: null,
    notes: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    colleague: { name: "Alice", username: "alice", isVirtual: false },
    ...overrides,
  };
}

describe("hrPayrollKeys", () => {
  it("namespaces list keys deterministically", () => {
    expect(hrPayrollKeys.all).toEqual(["hr", "payroll"]);
    expect(hrPayrollKeys.list("period=2026-06&page=1&limit=20")).toEqual([
      "hr",
      "payroll",
      "list",
      "period=2026-06&page=1&limit=20",
    ]);
  });
});

describe("payroll enums", () => {
  it("cover the record lifecycle", () => {
    expect(HR_PAYROLL_STATUSES).toEqual(["pending", "paid"]);
  });
});

describe("useHrPayrollRecords", () => {
  it("requests the default first page and unwraps data + meta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [row()],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }));
    const { result } = renderHook(() => useHrPayrollRecords(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.netAmount).toBe(103000);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/hr/payroll?");
    expect(url).toContain("page=1");
    expect(url).not.toContain("period=");
    expect(url).not.toContain("status=");
  });

  it("encodes period, colleague, and status filters into the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    }));
    const { result } = renderHook(
      () => useHrPayrollRecords({ colleagueId: "fc1", period: "2026-06", status: "paid" }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("colleagueId=fc1");
    expect(url).toContain("period=2026-06");
    expect(url).toContain("status=paid");
  });
});

describe("hr payroll mutations", () => {
  it("creates a record via POST with multi-currency support", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ currency: "USD" }) }, { status: 201 }));
    const { result } = renderHook(() => useCreateHrPayrollRecord(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({
      colleagueId: "fc1",
      period: "2026-06",
      baseSalary: 100000,
      bonus: 5000,
      deduction: 2000,
      currency: "USD",
    });
    expect(created.currency).toBe("USD");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/payroll");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      colleagueId: "fc1",
      period: "2026-06",
      baseSalary: 100000,
      bonus: 5000,
      deduction: 2000,
      currency: "USD",
    });
  });

  it("rejects a duplicate period with the server conflict message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "CONFLICT", message: "A payroll record for this colleague and period already exists" } },
      { status: 409 },
    ));
    const { result } = renderHook(() => useCreateHrPayrollRecord(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync({ colleagueId: "fc1", period: "2026-06", baseSalary: 1, currency: "CNY" }))
      .rejects
      .toThrow("already exists");
  });

  it("marks a record paid via PATCH status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: row({ status: "paid", paidAt: "2026-06-10T01:00:00.000Z" }),
    }));
    const { result } = renderHook(() => useUpdateHrPayrollRecord(), { wrapper: makeWrapper() });
    const paid = await result.current.mutateAsync({ id: "pr 1", status: "paid" });
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/payroll/pr%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "paid" });
  });

  it("deletes a pending record via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const { result } = renderHook(() => useDeleteHrPayrollRecord(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("pr1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/payroll/pr1");
    expect(init?.method).toBe("DELETE");
  });

  it("generates monthly payroll via POST /hr/payroll/generate and returns the counts", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { created: 3, skipped: 1 } }));
    const { result } = renderHook(() => useGeneratePayroll(), { wrapper: makeWrapper() });
    const summary = await result.current.mutateAsync({ period: "2026-06" });
    expect(summary).toEqual({ created: 3, skipped: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/hr/payroll/generate");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ period: "2026-06" });
  });
});
