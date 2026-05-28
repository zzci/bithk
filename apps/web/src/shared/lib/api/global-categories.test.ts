import type { GlobalProcurementCategory } from "./global-categories";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  useCreateGlobalCategory,
  useDeleteGlobalCategory,
  useGlobalCategories,
  useUpdateGlobalCategory,
} from "./global-categories";

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

function category(overrides: Partial<GlobalProcurementCategory> = {}): GlobalProcurementCategory {
  return {
    id: "gc1",
    name: "Hull",
    code: "H",
    description: null,
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("useGlobalCategories", () => {
  it("lists the global category template set", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [category()] }));
    const { result } = renderHook(() => useGlobalCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/global-procurement-categories");
  });
});

describe("global category mutations", () => {
  it("creates a category via POST with a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: category({ name: "Deck" }) }));
    const { result } = renderHook(() => useCreateGlobalCategory(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ name: "Deck", code: "D", description: null });
    expect(created.name).toBe("Deck");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/global-procurement-categories");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Deck", code: "D", description: null });
  });

  it("updates a category via PATCH, encoding the id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: category({ name: "Engine" }) }));
    const { result } = renderHook(() => useUpdateGlobalCategory(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ id: "gc 1", name: "Engine" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/global-procurement-categories/gc%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Engine" });
  });

  it("deletes a category via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteGlobalCategory(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("gc1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/global-procurement-categories/gc1");
    expect(init?.method).toBe("DELETE");
  });
});
