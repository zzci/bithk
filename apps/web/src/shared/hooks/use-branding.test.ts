import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DISPLAY_NAME } from "@/shared/lib/branding";
import { makeWrapper } from "@/test/utils";
import { useBranding } from "./use-branding";

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

describe("useBranding", () => {
  it("loads runtime display name from the system branding endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { appDisplayName: "Runtime App" } }));
    const { result } = renderHook(() => useBranding(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.appDisplayName).toBe("Runtime App"));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/system/branding");
  });

  it("falls back to build-time display name when the endpoint fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useBranding(), { wrapper: makeWrapper() });

    expect(result.current.appDisplayName).toBe(APP_DISPLAY_NAME);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.appDisplayName).toBe(APP_DISPLAY_NAME);
  });
});
