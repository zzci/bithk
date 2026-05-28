import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useDeleteSetting, usePutSetting, useSetting } from "./settings";

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

describe("useSetting", () => {
  it("unwraps the stored value", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { key: "project.defaults.status", value: "archived" } }));
    const { result } = renderHook(() => useSetting("project.defaults.status"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("archived");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/settings/project.defaults.status");
  });

  it("treats a 404 as an unset value (null) rather than an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "NOT_FOUND", message: "missing" } },
      { status: 404 },
    ));
    const { result } = renderHook(() => useSetting("project.defaults.coverReferenceId"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("propagates non-404 errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "no" } },
      { status: 403 },
    ));
    const { result } = renderHook(() => useSetting("project.defaults.status"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("settings mutations", () => {
  it("puts a value via PUT with a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => usePutSetting(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ key: "project.defaults.status", value: "active" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/settings/project.defaults.status");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ value: "active" });
  });

  it("deletes a setting via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteSetting(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("project.defaults.coverReferenceId");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/settings/project.defaults.coverReferenceId");
    expect(init?.method).toBe("DELETE");
  });
});
