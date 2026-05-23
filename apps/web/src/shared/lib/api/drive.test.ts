import type { DriveEntry } from "./drive";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  downloadDriveEntry,
  driveKeys,
  parseContentDispositionFilename,
  useAddMember,
  useCreateDriveFolder,
  useCreateTeamDirectory,
  useCreateTextFile,
  useDeleteTeamDirectory,
  useDirectoryMembers,
  useDriveEntries,
  useEmptyTrash,
  useEntryVersions,
  useFavoriteEntries,
  useRemoveMember,
  useRestoreDriveEntry,
  useSwitchVersion,
  useTeamDirectories,
  useTrashDriveEntry,
  useUpdateDriveEntry,
  useUpdateMember,
  useUpdateTeamDirectory,
  useUploadDriveFile,
  useUploadVersion,
} from "./drive";

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

function ok(data: unknown) {
  return async () => jsonResponse({ success: true, data });
}

function urlOf(i = 0): string {
  return String(fetchMock.mock.calls[i]![0]);
}

function methodOf(i = 0): string {
  return (fetchMock.mock.calls[i]![1]?.method ?? "GET").toUpperCase();
}

describe("parseContentDispositionFilename", () => {
  it("prefers the RFC 5987 extended form and decodes it", () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''r%C3%A9.txt")).toBe("ré.txt");
  });

  it("falls back to the plain quoted form", () => {
    expect(parseContentDispositionFilename("attachment; filename=\"a.pdf\"")).toBe("a.pdf");
  });

  it("returns undefined with no header", () => {
    expect(parseContentDispositionFilename(null)).toBeUndefined();
  });
});

describe("driveKeys.entries", () => {
  it("defaults owner/parent/status segments", () => {
    expect(driveKeys.entries({ parentEntryId: null, status: "normal" })).toEqual([
      "drive",
      "entries",
      "user",
      "self",
      "root",
      "normal",
    ]);
  });
});

describe("useDriveEntries — entriesPath", () => {
  it("always sets status and omits absent parent/owner", async () => {
    fetchMock.mockImplementation(ok([]));
    const { result } = renderHook(() => useDriveEntries(null, "normal"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = urlOf();
    expect(url).toContain("/drive/entries?");
    expect(url).toContain("status=normal");
    expect(url).not.toContain("parentEntryId=");
    expect(url).not.toContain("ownerType=");
  });

  it("forwards parent + owner scoping for a team directory listing", async () => {
    fetchMock.mockImplementation(ok([]));
    const { result } = renderHook(
      () => useDriveEntries("f1", "trash", { ownerType: "team_directory", ownerId: "td9" }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = urlOf();
    expect(url).toContain("status=trash");
    expect(url).toContain("parentEntryId=f1");
    expect(url).toContain("ownerType=team_directory");
    expect(url).toContain("ownerId=td9");
  });

  it("surfaces a load error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "no" } },
      { status: 403 },
    ));
    const { result } = renderHook(() => useDriveEntries(null, "normal"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("recent + favorite queries", () => {
  it("hit their dedicated endpoints", async () => {
    fetchMock.mockImplementation(ok([]));
    const fav = renderHook(() => useFavoriteEntries(), { wrapper: makeWrapper() });
    await waitFor(() => expect(fav.result.current.isSuccess).toBe(true));
    expect(urlOf()).toBe("/api/drive/entries/favorites");
  });
});

describe("entry mutations", () => {
  it("creates a folder via POST /drive/folders", async () => {
    fetchMock.mockImplementation(ok({ id: "e1" }));
    const { result } = renderHook(() => useCreateDriveFolder(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ name: "Docs", parentEntryId: null });
    expect(urlOf()).toBe("/api/drive/folders");
    expect(methodOf()).toBe("POST");
  });

  it("uploads a file as multipart FormData", async () => {
    fetchMock.mockImplementation(ok({ id: "e2" }));
    const { result } = renderHook(() => useUploadDriveFile(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({
      file: new File(["x"], "a.txt"),
      parentEntryId: "p1",
      ownerType: "project",
      ownerId: "pr1",
    });
    expect(urlOf()).toBe("/api/drive/files/upload");
    const body = fetchMock.mock.calls[0]![1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("parentEntryId")).toBe("p1");
    expect(form.get("ownerType")).toBe("project");
  });

  it("creates a text file, renames, favorites, trashes and restores", async () => {
    fetchMock.mockImplementation(ok({ id: "e3" }));
    const text = renderHook(() => useCreateTextFile(), { wrapper: makeWrapper() });
    await text.result.current.mutateAsync({ name: "n.md", content: "", parentEntryId: null });
    const update = renderHook(() => useUpdateDriveEntry(), { wrapper: makeWrapper() });
    await update.result.current.mutateAsync({ id: "e 3", name: "new", favorite: true });
    const trash = renderHook(() => useTrashDriveEntry(), { wrapper: makeWrapper() });
    await trash.result.current.mutateAsync("e3");
    const restore = renderHook(() => useRestoreDriveEntry(), { wrapper: makeWrapper() });
    await restore.result.current.mutateAsync("e3");
    expect(fetchMock.mock.calls.map(c => `${(c[1]?.method ?? "GET").toUpperCase()} ${String(c[0])}`)).toEqual([
      "POST /api/drive/entries/text-file",
      "PATCH /api/drive/entries/e%203",
      "DELETE /api/drive/entries/e3",
      "POST /api/drive/entries/e3/restore",
    ]);
  });

  it("empties the trash", async () => {
    fetchMock.mockImplementation(ok({ removed: 4 }));
    const { result } = renderHook(() => useEmptyTrash(), { wrapper: makeWrapper() });
    const res = await result.current.mutateAsync();
    expect(res.removed).toBe(4);
    expect(urlOf()).toBe("/api/drive/entries/trash");
    expect(methodOf()).toBe("DELETE");
  });
});

describe("downloadDriveEntry", () => {
  it("skips non-file entries", async () => {
    await downloadDriveEntry({ id: "e1", name: "Folder", file: null } as unknown as DriveEntry);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the blob and triggers an anchor download", async () => {
    const createUrl = vi.fn(() => "blob:x");
    const revokeUrl = vi.fn();
    URL.createObjectURL = createUrl as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeUrl as unknown as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response(new Blob(["data"]), { status: 200 }));

    await downloadDriveEntry({ id: "e9", name: "report.pdf", file: { fileId: "f1" } } as unknown as DriveEntry);

    expect(urlOf()).toBe("/api/drive/entries/e9/content");
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith("blob:x");
    clickSpy.mockRestore();
  });
});

describe("file versions", () => {
  it("lists versions only when an entry id is present", async () => {
    const disabled = renderHook(() => useEntryVersions(undefined), { wrapper: makeWrapper() });
    expect(disabled.result.current.fetchStatus).toBe("idle");

    fetchMock.mockImplementation(ok([]));
    const enabled = renderHook(() => useEntryVersions("e1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
    expect(urlOf()).toBe("/api/drive/entries/e1/versions");
  });

  it("uploads a new version as FormData and switches the current version", async () => {
    fetchMock.mockImplementation(ok([]));
    const upload = renderHook(() => useUploadVersion(), { wrapper: makeWrapper() });
    await upload.result.current.mutateAsync({ entryId: "e1", file: new File(["v2"], "v2.bin") });
    expect(urlOf()).toBe("/api/drive/entries/e1/versions");
    expect(fetchMock.mock.calls[0]![1]?.body).toBeInstanceOf(FormData);

    fetchMock.mockClear();
    const switchV = renderHook(() => useSwitchVersion(), { wrapper: makeWrapper() });
    await switchV.result.current.mutateAsync({ entryId: "e1", versionId: "v0" });
    expect(urlOf()).toBe("/api/drive/entries/e1/versions/v0/current");
    expect(methodOf()).toBe("POST");
  });
});

describe("team directories + members", () => {
  it("lists, creates, updates (PUT) and deletes a directory", async () => {
    fetchMock.mockImplementation(ok({ id: "td1", name: "Team" }));
    const list = renderHook(() => useTeamDirectories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(urlOf()).toBe("/api/drive/team-directories");

    const create = renderHook(() => useCreateTeamDirectory(), { wrapper: makeWrapper() });
    await create.result.current.mutateAsync({ name: "Team" });
    const update = renderHook(() => useUpdateTeamDirectory(), { wrapper: makeWrapper() });
    await update.result.current.mutateAsync({ id: "td1", name: "Renamed" });
    const del = renderHook(() => useDeleteTeamDirectory(), { wrapper: makeWrapper() });
    await del.result.current.mutateAsync("td1");

    const calls = fetchMock.mock.calls.slice(1).map(c => `${(c[1]?.method ?? "GET").toUpperCase()} ${String(c[0])}`);
    expect(calls).toEqual([
      "POST /api/drive/team-directories",
      "PUT /api/drive/team-directories/td1",
      "DELETE /api/drive/team-directories/td1",
    ]);
  });

  it("lists, adds, updates and removes members", async () => {
    fetchMock.mockImplementation(ok({ id: "m1" }));
    const list = renderHook(() => useDirectoryMembers("td1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(urlOf()).toBe("/api/drive/team-directories/td1/members");

    const add = renderHook(() => useAddMember(), { wrapper: makeWrapper() });
    await add.result.current.mutateAsync({ directoryId: "td1", userId: "u1", role: "editor" });
    const update = renderHook(() => useUpdateMember(), { wrapper: makeWrapper() });
    await update.result.current.mutateAsync({ directoryId: "td1", memberId: "m1", role: "viewer" });
    const remove = renderHook(() => useRemoveMember(), { wrapper: makeWrapper() });
    await remove.result.current.mutateAsync({ directoryId: "td1", memberId: "m1" });

    const calls = fetchMock.mock.calls.slice(1).map(c => `${(c[1]?.method ?? "GET").toUpperCase()} ${String(c[0])}`);
    expect(calls).toEqual([
      "POST /api/drive/team-directories/td1/members",
      "PUT /api/drive/team-directories/td1/members/m1",
      "DELETE /api/drive/team-directories/td1/members/m1",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ userId: "u1", role: "editor" });
  });
});
