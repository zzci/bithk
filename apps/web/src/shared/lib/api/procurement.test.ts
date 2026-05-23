import type { ProcurementRow } from "./procurement";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  procurementKeys,
  useChangeProcurementStatus,
  useCreateProcurement,
  useDeleteProcurement,
  useProcurements,
  useUpdateProcurement,
} from "./procurement";

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

function row(overrides: Partial<ProcurementRow> = {}): ProcurementRow {
  return {
    id: "pr1",
    projectId: "proj1",
    title: null,
    itemName: "Cement",
    status: "draft",
    supplierId: null,
    categoryId: null,
    assigneeMemberId: null,
    quantity: null,
    amount: null,
    currency: null,
    creatorId: "u1",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("procurementKeys", () => {
  it("namespaces list and project keys deterministically", () => {
    expect(procurementKeys.list("p", "ordered", "c1", 2)).toEqual([
      "procurements",
      "p",
      "list",
      "ordered",
      "c1",
      2,
    ]);
    expect(procurementKeys.byProject("p")).toEqual(["procurements", "p"]);
  });
});

describe("useProcurements", () => {
  it("stays disabled until a projectId is supplied", () => {
    const { result } = renderHook(() => useProcurements(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the default first page and unwraps data + meta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [row()],
      meta: { total: 1, page: 1, limit: 20 },
    }));
    const { result } = renderHook(() => useProcurements("proj1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.meta.total).toBe(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/projects/proj1/procurements?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("categoryId=");
  });

  it("encodes status, category and pagination filters into the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [],
      meta: { total: 0, page: 3, limit: 50 },
    }));
    const { result } = renderHook(
      () => useProcurements("proj1", { status: "ordered", categoryId: "cat9", page: 3, limit: 50 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("status=ordered");
    expect(url).toContain("categoryId=cat9");
    expect(url).toContain("page=3");
    expect(url).toContain("limit=50");
  });

  it("surfaces a 403 as an error without retrying", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "no access" } },
      { status: 403 },
    ));
    const { result } = renderHook(() => useProcurements("proj1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("procurement mutations", () => {
  it("creates a row via POST with a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ itemName: "Steel" }) }));
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ projectId: "proj1", itemName: "Steel" });
    expect(created.itemName).toBe("Steel");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/proj1/procurements");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ itemName: "Steel" });
  });

  it("patches a row, encoding the id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ title: "Updated" }) }));
    const { result } = renderHook(() => useUpdateProcurement(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ projectId: "proj1", id: "pr 1", title: "Updated" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/proj1/procurements/pr%201");
    expect(init?.method).toBe("PATCH");
  });

  it("deletes a row via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteProcurement(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ projectId: "proj1", id: "pr1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/proj1/procurements/pr1");
    expect(init?.method).toBe("DELETE");
  });

  it("changes status through the dedicated endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: row({ status: "received" }) }));
    const { result } = renderHook(() => useChangeProcurementStatus(), { wrapper: makeWrapper() });
    const updated = await result.current.mutateAsync({ projectId: "proj1", id: "pr1", status: "received" });
    expect(updated.status).toBe("received");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/proj1/procurements/pr1/status");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "received" });
  });

  it("rejects when the server returns a validation error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "VALIDATION", message: "itemName required" } },
      { status: 422 },
    ));
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync({ projectId: "proj1", itemName: "" })).rejects.toThrow("itemName required");
  });
});
