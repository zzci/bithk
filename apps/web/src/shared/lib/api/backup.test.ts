import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestQueryClient, makeWrapper } from "@/test/utils";
import {
  backupKeys,
  useApplyBackupImport,
  useBackupExportJob,
  useBackupImportJob,
  useBackupModules,
  useCancelBackupExport,
  useDiscardBackupImport,
  useRestoreBlobArchive,
  useStartBackupExport,
  useUploadBackupImport,
} from "./backup";

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

function call(index = 0): [string, RequestInit | undefined] {
  const [url, init] = fetchMock.mock.calls[index]!;
  return [String(url), init];
}

describe("useBackupModules", () => {
  it("fetches the module catalog and unwraps the modules array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ modules: [{ name: "file", deps: [] }] }));
    const { result } = renderHook(() => useBackupModules(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call()[0]).toBe("/api/backup/modules");
    expect(result.current.data).toEqual([{ name: "file", deps: [] }]);
  });
});

describe("export job", () => {
  it("does not poll without a job id", () => {
    const { result } = renderHook(() => useBackupExportJob(null), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts an export via POST with modules only (FIX-062: no blobs option)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ jobId: "j1" }));
    const { result } = renderHook(() => useStartBackupExport(), { wrapper: makeWrapper() });
    const res = await result.current.mutateAsync({ modules: ["file"] });
    expect(res.jobId).toBe("j1");
    const [url, init] = call();
    expect(url).toBe("/api/backup/v2/exports");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ modules: ["file"] });
  });

  it("cancels an export via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const { result } = renderHook(() => useCancelBackupExport(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("j1");
    expect(call()).toEqual(["/api/backup/v2/exports/j1", expect.objectContaining({ method: "DELETE" })]);
  });
});

describe("import job", () => {
  it("does not poll without an import id", () => {
    const { result } = renderHook(() => useBackupImportJob(null), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads the archive as multipart form data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ importId: "imp1", report: {} }));
    const { result } = renderHook(() => useUploadBackupImport(), { wrapper: makeWrapper() });
    const res = await result.current.mutateAsync(new File(["x"], "backup.tar.gz"));
    expect(res.importId).toBe("imp1");
    const [url, init] = call();
    expect(url).toBe("/api/backup/v2/imports");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("applies the staged import and invalidates its poll query", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    const queryClient: QueryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useApplyBackupImport(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ importId: "imp1", wipeExisting: true });

    const [url, init] = call();
    expect(url).toBe("/api/backup/v2/imports/imp1/apply");
    expect(JSON.parse(String(init?.body))).toEqual({ wipeExisting: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: backupKeys.importJob("imp1") });
  });

  it("treats a 404 on discard as already-gone", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: { code: "NOT_FOUND", message: "gone" } }, { status: 404 }));
    const { result } = renderHook(() => useDiscardBackupImport(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync("imp1")).resolves.toBeUndefined();
  });
});

describe("useRestoreBlobArchive", () => {
  it("pOSTs the blobs archive and returns the restore report", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ report: { written: 2 } }));
    const { result } = renderHook(() => useRestoreBlobArchive(), { wrapper: makeWrapper() });
    const res = await result.current.mutateAsync(new File(["x"], "blobs.tar.gz"));
    expect(res.report).toEqual({ written: 2 });
    expect(call()[0]).toBe("/api/backup/v2/blob-restores");
  });
});
