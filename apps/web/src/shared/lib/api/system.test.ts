import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestQueryClient, makeWrapper } from "@/test/utils";
import { systemKeys, useLodeHold, useLodeRestart, useLodeRollback, useLodeUpdate, useSystemVersion } from "./system";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function call(index = 0): [string, RequestInit | undefined] {
  const [url, init] = fetchMock.mock.calls[index]!;
  return [String(url), init];
}

describe("useSystemVersion", () => {
  it("fetches /system/version and unwraps the data envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { version: "1.2.3", commit: "abc", buildTime: null } }));
    const { result } = renderHook(() => useSystemVersion(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call()[0]).toBe("/api/system/version");
    expect(result.current.data?.version).toBe("1.2.3");
  });
});

describe("lode mutations", () => {
  it("pOSTs each lode action to its endpoint", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true }));

    const restart = renderHook(() => useLodeRestart(), { wrapper: makeWrapper() });
    await restart.result.current.mutateAsync();
    const update = renderHook(() => useLodeUpdate(), { wrapper: makeWrapper() });
    await update.result.current.mutateAsync("1.2.4");
    const rollback = renderHook(() => useLodeRollback(), { wrapper: makeWrapper() });
    await rollback.result.current.mutateAsync(undefined);
    const hold = renderHook(() => useLodeHold(), { wrapper: makeWrapper() });
    await hold.result.current.mutateAsync(true);

    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      "/api/system/lode/restart",
      "/api/system/lode/update",
      "/api/system/lode/rollback",
      "/api/system/lode/hold",
    ]);
    expect(JSON.parse(String(call(1)[1]?.body))).toEqual({ target: "1.2.4" });
    expect(JSON.parse(String(call(2)[1]?.body))).toEqual({});
    expect(JSON.parse(String(call(3)[1]?.body))).toEqual({ hold: true });
  });

  it("refreshes the version snapshot after a lode action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const queryClient: QueryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useLodeHold(), { wrapper: makeWrapper(queryClient) });
    await result.current.mutateAsync(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: systemKeys.version });
  });
});
