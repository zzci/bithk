import type { WorklistCategory } from "./worklist-categories";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  useCreateWorklistCategory,
  useDeleteWorklistCategory,
  useUpdateWorklistCategory,
  useWorklistCategories,
} from "./worklist-categories";

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

function category(overrides: Partial<WorklistCategory> = {}): WorklistCategory {
  return {
    id: "wc1",
    name: "Routine Maintenance",
    description: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("useWorklistCategories", () => {
  it("lists the global worklist category vocabulary", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [category()] }));
    const { result } = renderHook(() => useWorklistCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/worklist-categories");
  });
});

describe("worklist category mutations", () => {
  it("creates a category via POST with a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: category({ name: "Safety Inspection" }) }));
    const { result } = renderHook(() => useCreateWorklistCategory(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ name: "Safety Inspection", description: null });
    expect(created.name).toBe("Safety Inspection");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/worklist-categories");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Safety Inspection", description: null });
  });

  it("updates a category via PATCH, encoding the id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: category({ name: "Equipment Repair" }) }));
    const { result } = renderHook(() => useUpdateWorklistCategory(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ id: "wc 1", name: "Equipment Repair" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/worklist-categories/wc%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Equipment Repair" });
  });

  it("deletes a category via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteWorklistCategory(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("wc1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/worklist-categories/wc1");
    expect(init?.method).toBe("DELETE");
  });
});
