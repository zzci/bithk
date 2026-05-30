import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { pinKeys, usePinnedItems, useToggleIssuePin, useToggleProcurementPin } from "./pins";

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

describe("pinKeys", () => {
  it("builds a stable pinned-items key", () => {
    expect(pinKeys.pinnedItems("p1")).toEqual(["projects", "p1", "pinned-items"]);
  });
});

describe("usePinnedItems", () => {
  it("does not fetch without a project id", () => {
    const { result } = renderHook(() => usePinnedItems(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the pinned-items list and unwraps the envelope", async () => {
    const items = [{ id: "x1", shortId: "i1", type: "issue", title: "Fix", status: "todo", pinnedAt: "2026-05-24T00:00:00.000Z" }];
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: items }));
    const { result } = renderHook(() => usePinnedItems("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/pinned-items");
  });
});

describe("useToggleIssuePin", () => {
  it("posts to /pin when pinning and /unpin when unpinning", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: { id: "i1" } }));
    const { result } = renderHook(() => useToggleIssuePin(), { wrapper: makeWrapper() });

    await result.current.mutateAsync({ projectId: "p1", id: "i1", pin: true });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/issues/i1/pin");
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("POST");

    await result.current.mutateAsync({ projectId: "p1", id: "i1", pin: false });
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/projects/p1/issues/i1/unpin");
  });
});

describe("useToggleProcurementPin", () => {
  it("posts to the procurement pin/unpin endpoints", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: { id: "pr1" } }));
    const { result } = renderHook(() => useToggleProcurementPin(), { wrapper: makeWrapper() });

    await result.current.mutateAsync({ projectId: "p1", id: "pr1", pin: true });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/procurements/pr1/pin");
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("POST");

    await result.current.mutateAsync({ projectId: "p1", id: "pr1", pin: false });
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/projects/p1/procurements/pr1/unpin");
  });
});
