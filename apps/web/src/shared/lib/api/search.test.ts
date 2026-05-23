import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useGlobalSearch } from "./search";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
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

const empty = { documents: [], issues: [], projects: [], drive: [] };

describe("useGlobalSearch", () => {
  it("stays disabled for an empty or whitespace-only query", () => {
    const { result } = renderHook(() => useGlobalSearch("   "), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and url-encodes the trimmed query, unwrapping the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { ...empty, documents: [{ type: "document", id: "d1", title: "Plan" }] },
    }));
    const { result } = renderHook(() => useGlobalSearch("  road map  "), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.documents).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/search?q=road%20map");
  });
});
