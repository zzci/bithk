import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useDefaultCover, useRemoveDefaultCover, useUploadDefaultCover } from "./admin-default-cover";

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

describe("useDefaultCover", () => {
  it("unwraps the current default cover", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { referenceId: "ref-1", url: "/api/files/file-1/content?ref=ref-1&inline=true" },
    }));
    const { result } = renderHook(() => useDefaultCover(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ referenceId: "ref-1", url: "/api/files/file-1/content?ref=ref-1&inline=true" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/admin/project-default-cover");
  });

  it("represents an unset cover as null fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { referenceId: null, url: null } }));
    const { result } = renderHook(() => useDefaultCover(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ referenceId: null, url: null });
  });
});

describe("default-cover mutations", () => {
  it("uploads via POST with a multipart `file` field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { referenceId: "ref-2", url: "/api/files/file-2/content?inline=true" } }));
    const { result } = renderHook(() => useUploadDefaultCover(), { wrapper: makeWrapper() });
    const file = new File(["x"], "cover.png", { type: "image/png" });
    const data = await result.current.mutateAsync(file);
    expect(data.referenceId).toBe("ref-2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/admin/project-default-cover");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBe(file);
  });

  it("surfaces an INVALID_MIMETYPE error from the server", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "INVALID_MIMETYPE", message: "Cover image must be an image file" } },
      { status: 400 },
    ));
    const { result } = renderHook(() => useUploadDefaultCover(), { wrapper: makeWrapper() });
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    await expect(result.current.mutateAsync(file)).rejects.toThrow("Cover image must be an image file");
  });

  it("removes the default cover via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useRemoveDefaultCover(), { wrapper: makeWrapper() });
    await result.current.mutateAsync();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/admin/project-default-cover");
    expect(init?.method).toBe("DELETE");
  });
});
