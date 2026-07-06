// FIX-064 regression: the direct-upload path must POST presign/confirm to
// `/api/drive/files/...` — `postJson` used to prepend `/api` on top of the
// callers' `/api/...` paths, producing `/api/api/...` 404s in production.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useFileUploader, useFileUploadStore } from "./upload-queue";

vi.mock("@/shared/hooks/use-upload-limits", () => ({
  useUploadLimits: () => ({
    maxFileSize: 1024 * 1024,
    maxAttachmentsPerResource: 20,
    totalQuota: null,
    directUpload: true,
  }),
}));

// CI's jsdom lacks `crypto.subtle`; a throwing hash would silently exercise
// the multipart fallback instead of the direct path under test.
vi.mock("@/shared/lib/direct-upload", () => ({
  sha256Hex: async () => "ab".repeat(32),
}));

/** Minimal XHR stand-in: records the PUT target and succeeds immediately. */
class FakeXhr {
  static puts: Array<{ method: string; url: string }> = [];
  upload = { addEventListener: vi.fn() };
  status = 200;
  private listeners = new Map<string, () => void>();
  addEventListener(event: string, cb: () => void): void {
    this.listeners.set(event, cb);
  }

  open(method: string, url: string): void {
    FakeXhr.puts.push({ method, url });
  }

  setRequestHeader(): void {}
  send(): void {
    this.listeners.get("load")?.();
  }
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  FakeXhr.puts = [];
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  useFileUploadStore.setState({ tasks: [], preparing: false });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function renderUploader() {
  const { result } = renderHook(() => useFileUploader(), { wrapper: makeWrapper() });
  return { enqueue: result.current };
}

describe("useFileUploader direct upload (FIX-064)", () => {
  it("pOSTs presign and confirm to /api/drive/files/... (no double /api) and PUTs to the presigned URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { mode: "upload", upload: { url: "https://bucket.example/2026070609/abc?sig=1", method: "PUT", headers: { "Content-Type": "text/plain" } } },
      }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { id: "e1" } }));

    const { enqueue } = renderUploader();
    enqueue(
      [new File(["hello"], "a.txt", { type: "text/plain" })],
      { ownerType: "user", ownerId: "u1", parentEntryId: null },
    );

    await waitFor(() => {
      expect(useFileUploadStore.getState().tasks[0]?.status).toBe("done");
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toBe("/api/drive/files/presign-upload");
    expect(urls[1]).toBe("/api/drive/files/confirm-upload");
    expect(FakeXhr.puts).toEqual([{ method: "PUT", url: "https://bucket.example/2026070609/abc?sig=1" }]);
  });

  it("falls back to the multipart API path on the same task when presign fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 404 }));

    const { enqueue } = renderUploader();
    enqueue(
      [new File(["hello"], "a.txt", { type: "text/plain" })],
      { ownerType: "user", ownerId: "u1", parentEntryId: null },
    );

    await waitFor(() => {
      expect(useFileUploadStore.getState().tasks[0]?.status).toBe("done");
    });
    // One queue task only, completed via the multipart XHR fallback.
    expect(useFileUploadStore.getState().tasks).toHaveLength(1);
    expect(FakeXhr.puts).toEqual([{ method: "POST", url: "/api/drive/files/upload" }]);
  });

  it("finishes without a storage PUT when presign dedups (mode: done)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { mode: "done", entry: { id: "e1" } } }));

    const { enqueue } = renderUploader();
    enqueue(
      [new File(["hello"], "a.txt", { type: "text/plain" })],
      { ownerType: "user", ownerId: "u1", parentEntryId: null },
    );

    await waitFor(() => {
      expect(useFileUploadStore.getState().tasks[0]?.status).toBe("done");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/drive/files/presign-upload");
    expect(FakeXhr.puts).toEqual([]);
  });
});
