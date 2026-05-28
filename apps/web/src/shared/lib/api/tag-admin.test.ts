import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useCreateTag, useDeleteTag, useRenameTag } from "./tag-admin";

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

describe("tag admin mutations", () => {
  it("creates a tag via POST /tags", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "t1", name: "VIP", usageCount: 0 } }));
    const { result } = renderHook(() => useCreateTag(), { wrapper: makeWrapper() });
    const created = await result.current.mutateAsync({ name: "VIP" });
    expect(created.name).toBe("VIP");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/tags");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "VIP" });
  });

  it("renames a tag via PATCH, encoding the id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "t 1", name: "Gold", usageCount: 2 } }));
    const { result } = renderHook(() => useRenameTag(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ id: "t 1", name: "Gold" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/tags/t%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Gold" });
  });

  it("deletes a tag via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteTag(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("t1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/tags/t1");
    expect(init?.method).toBe("DELETE");
  });
});
