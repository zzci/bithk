// Drive data layer: types, raw clients, and TanStack Query hooks.
//
// Mirrors the backend drive module (apps/api/src/modules/drive). Every
// response shape matches the corresponding service view exactly:
//   - DriveEntry        ↔ DriveEntryView      (drive.service.ts)
//   - DriveFileVersion  ↔ DriveVersionView    (drive.version.service.ts)
//   - TeamDirectory     ↔ TeamDirectoryView   (drive.team-directory.service.ts)
//   - TeamDirectoryMember ↔ team_directory_members row
//
// Sharing lives in the unified `share` module (shared/lib/api/share.ts);
// this module no longer carries any share types, keys, or hooks.
//
// All requests go through the shared `httpRaw` client so credentials, the
// CSRF header on mutating methods, and the global `unauthorized` event stay
// consistent. Never call `fetch` directly.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HttpError, httpRaw } from "../http";

// ── Types ──

export type DriveOwnerType = "user" | "team_directory" | "project";
type DriveEntryType = "folder" | "file";
export type DriveEntryStatus = "normal" | "trash";
export type TeamDirectoryRole = "admin" | "editor" | "viewer";

export interface DriveEntry {
  readonly id: string;
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
  readonly parentEntryId: string | null;
  readonly type: DriveEntryType;
  readonly name: string;
  readonly favorite: boolean;
  readonly status: DriveEntryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file: {
    readonly referenceId: string;
    readonly fileId: string;
    readonly filename: string;
    readonly mimetype: string;
    readonly size: number;
  } | null;
}

export interface DriveFileVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
  /** True when this version's reference is the entry's current pointer. */
  readonly isCurrent: boolean;
}

export interface TeamDirectory {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Effective role of the requesting user (creator is always admin). */
  readonly role: TeamDirectoryRole;
  readonly memberCount: number;
}

export interface TeamDirectoryMember {
  readonly id: string;
  readonly directoryId: string;
  readonly userId: string;
  readonly role: TeamDirectoryRole;
  readonly createdAt: string;
}

// ── Query keys ──

export interface DriveEntriesQuery {
  readonly ownerType?: DriveOwnerType | undefined;
  readonly ownerId?: string | undefined;
  readonly parentEntryId?: string | null | undefined;
  readonly status?: DriveEntryStatus | undefined;
}

export const driveKeys = {
  all: ["drive"] as const,
  detail: (id: string) => ["drive", "entries", id, "detail"] as const,
  entries: (query: DriveEntriesQuery) => [
    "drive",
    "entries",
    query.ownerType ?? "user",
    query.ownerId ?? "self",
    query.parentEntryId ?? "root",
    query.status ?? "normal",
  ] as const,
  search: (query: DriveEntriesQuery & { readonly q: string }) => [
    "drive",
    "entries",
    "search",
    query.ownerType ?? "user",
    query.ownerId ?? "self",
    query.q,
  ] as const,
  recent: () => ["drive", "entries", "recent"] as const,
  favorites: () => ["drive", "entries", "favorites"] as const,
  versions: (entryId: string) => ["drive", "entries", entryId, "versions"] as const,
  teamDirectories: () => ["drive", "team-directories"] as const,
  teamDirectory: (id: string) => ["drive", "team-directories", id] as const,
  directoryMembers: (id: string) => ["drive", "team-directories", id, "members"] as const,
};

// ── Helpers ──

async function rawJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await httpRaw(path, init);
  return (await res.json()) as T;
}

function entriesPath(query: DriveEntriesQuery): string {
  const params = new URLSearchParams();
  params.set("status", query.status ?? "normal");
  if (query.parentEntryId)
    params.set("parentEntryId", query.parentEntryId);
  // The backend GET /drive/entries currently scopes to the caller's personal
  // drive and ignores owner params; they are forwarded here so the same hook
  // (and cache key) can list a team directory once the route honors them.
  if (query.ownerType)
    params.set("ownerType", query.ownerType);
  if (query.ownerId)
    params.set("ownerId", query.ownerId);
  return `/drive/entries?${params.toString()}`;
}

/**
 * Extract the display filename from a `Content-Disposition` header. Handles
 * both the RFC 5987 `filename*=UTF-8''…` form (preferred) and the plain
 * `filename="…"` form. Returns `undefined` when neither is present.
 */
export function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header)
    return undefined;
  const extended = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^["']|["']$/g, ""));
    }
    catch {
      // fall through to the plain form on malformed percent-encoding
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim();
}

// ── Univer spreadsheets ──

/** Mimetype of the Univer spreadsheet snapshot stored as a drive file. */
export const UNIVER_SHEET_MIME = "application/x-univer-sheet";

/**
 * True when the entry is a Univer spreadsheet. Matches the stored mimetype;
 * when that is empty, falls back to the `.sheet` filename suffix.
 */
export function isUniverSheetEntry(entry: DriveEntry): boolean {
  const mimetype = entry.file?.mimetype;
  if (mimetype)
    return mimetype === UNIVER_SHEET_MIME;
  return entry.name.toLowerCase().endsWith(".sheet");
}

/**
 * Fetch the raw file content of an entry as text. The editor uses this to load
 * a spreadsheet's snapshot JSON. `inline=true` keeps the response in-band
 * (no download disposition).
 */
export async function fetchDriveEntryContent(entryId: string): Promise<string> {
  const res = await httpRaw(`/drive/entries/${encodeURIComponent(entryId)}/content?inline=true`);
  return res.text();
}

// ── Entries: queries ──

/**
 * List entries in a folder. Defaults to the caller's personal drive; pass an
 * `owner` to scope a team directory listing (see `entriesPath` for the
 * current backend caveat).
 */
export function useDriveEntries(
  parentEntryId: string | null,
  status: DriveEntryStatus,
  owner?: { readonly ownerType: DriveOwnerType; readonly ownerId: string },
) {
  const query: DriveEntriesQuery = { parentEntryId, status, ...(owner ?? {}) };
  return useQuery({
    queryKey: driveKeys.entries(query),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveEntry[]>>(entriesPath(query)).then(r => r.data),
    staleTime: 5_000,
  });
}

export function useDriveSearchEntries(
  q: string,
  owner?: { readonly ownerType: DriveOwnerType; readonly ownerId: string },
) {
  const query = { ...(owner ?? {}), q: q.trim() };
  return useQuery({
    queryKey: driveKeys.search(query),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("q", query.q);
      params.set("limit", "50");
      if (owner?.ownerType)
        params.set("ownerType", owner.ownerType);
      if (owner?.ownerId)
        params.set("ownerId", owner.ownerId);
      return rawJson<ApiEnvelope<readonly DriveEntry[]>>(`/drive/entries/search?${params.toString()}`).then(r => r.data);
    },
    enabled: query.q.length > 0,
    staleTime: 5_000,
  });
}

export function useRecentEntries() {
  return useQuery({
    queryKey: driveKeys.recent(),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveEntry[]>>("/drive/entries/recent").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useFavoriteEntries() {
  return useQuery({
    queryKey: driveKeys.favorites(),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveEntry[]>>("/drive/entries/favorites").then(r => r.data),
    staleTime: 5_000,
  });
}

/** Fetch a single entry by id. Used to resolve a spreadsheet before editing. */
export function useDriveEntry(entryId: string | undefined) {
  return useQuery({
    queryKey: driveKeys.detail(entryId ?? ""),
    queryFn: () => rawJson<ApiEnvelope<DriveEntry>>(`/drive/entries/${encodeURIComponent(entryId!)}`).then(r => r.data),
    enabled: !!entryId,
    staleTime: 5_000,
  });
}

// ── Entries: mutations ──

export interface CreateDriveFolderInput {
  readonly name: string;
  readonly parentEntryId: string | null;
  readonly ownerType?: DriveOwnerType | undefined;
  readonly ownerId?: string | undefined;
}

export function useCreateDriveFolder(): UseMutationResult<DriveEntry, Error, CreateDriveFolderInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => rawJson<ApiEnvelope<DriveEntry>>("/drive/folders", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export interface UploadDriveFileInput {
  readonly file: File;
  readonly parentEntryId: string | null;
  readonly ownerType?: DriveOwnerType | undefined;
  readonly ownerId?: string | undefined;
}

export function useUploadDriveFile(): UseMutationResult<DriveEntry, Error, UploadDriveFileInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, parentEntryId, ownerType, ownerId }) => {
      const form = new FormData();
      form.set("file", file);
      if (parentEntryId)
        form.set("parentEntryId", parentEntryId);
      if (ownerType)
        form.set("ownerType", ownerType);
      if (ownerId)
        form.set("ownerId", ownerId);
      const body = await rawJson<ApiEnvelope<DriveEntry>>("/drive/files/upload", {
        method: "POST",
        body: form,
      });
      return body.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export interface CreateTextFileInput {
  readonly name: string;
  readonly content: string;
  readonly parentEntryId: string | null;
  readonly ownerType?: DriveOwnerType | undefined;
  readonly ownerId?: string | undefined;
}

export function useCreateTextFile(): UseMutationResult<DriveEntry, Error, CreateTextFileInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => rawJson<ApiEnvelope<DriveEntry>>("/drive/entries/text-file", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export interface CreateSpreadsheetInput {
  readonly name: string;
  readonly content: string;
  readonly parentEntryId: string | null;
  readonly ownerType?: DriveOwnerType | undefined;
  readonly ownerId?: string | undefined;
}

export function useCreateSpreadsheet(): UseMutationResult<DriveEntry, Error, CreateSpreadsheetInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => rawJson<ApiEnvelope<DriveEntry>>("/drive/entries/spreadsheet", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useUpdateDriveEntry(): UseMutationResult<DriveEntry, Error, {
  id: string;
  name?: string;
  parentEntryId?: string | null;
  favorite?: boolean;
}> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => rawJson<ApiEnvelope<DriveEntry>>(`/drive/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useTrashDriveEntry(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/drive/entries/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useRestoreDriveEntry(): UseMutationResult<DriveEntry, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<DriveEntry>>(`/drive/entries/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useDeleteDriveEntryPermanently(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/drive/entries/${encodeURIComponent(id)}/permanent`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

/** Permanently delete every trashed entry. Returns the count removed. */
export function useEmptyTrash(): UseMutationResult<{ readonly removed: number }, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rawJson<ApiEnvelope<{ readonly removed: number }>>("/drive/entries/trash", {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export async function downloadDriveEntry(entry: DriveEntry): Promise<void> {
  if (!entry.file)
    return;
  const res = await httpRaw(`/drive/entries/${encodeURIComponent(entry.id)}/content`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = entry.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── File versions ──

export function useEntryVersions(entryId: string | undefined) {
  return useQuery({
    queryKey: driveKeys.versions(entryId ?? ""),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveFileVersion[]>>(`/drive/entries/${encodeURIComponent(entryId!)}/versions`).then(r => r.data),
    enabled: !!entryId,
    staleTime: 5_000,
  });
}

export function useUploadVersion(): UseMutationResult<readonly DriveFileVersion[], Error, { entryId: string; file: File }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, file }) => {
      const form = new FormData();
      form.set("file", file);
      const body = await rawJson<ApiEnvelope<readonly DriveFileVersion[]>>(`/drive/entries/${encodeURIComponent(entryId)}/versions`, {
        method: "POST",
        body: form,
      });
      return body.data;
    },
    onSuccess: (_data, { entryId }) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.versions(entryId) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.all });
    },
  });
}

export function useSwitchVersion(): UseMutationResult<readonly DriveFileVersion[], Error, { entryId: string; versionId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, versionId }) => rawJson<ApiEnvelope<readonly DriveFileVersion[]>>(
      `/drive/entries/${encodeURIComponent(entryId)}/versions/${encodeURIComponent(versionId)}/current`,
      { method: "POST" },
    ).then(r => r.data),
    onSuccess: (_data, { entryId }) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.versions(entryId) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.all });
    },
  });
}

// ── Team directories ──

export function useTeamDirectories() {
  return useQuery({
    queryKey: driveKeys.teamDirectories(),
    queryFn: () => rawJson<ApiEnvelope<readonly TeamDirectory[]>>("/drive/team-directories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useTeamDirectory(id: string | undefined) {
  return useQuery({
    queryKey: driveKeys.teamDirectory(id ?? ""),
    queryFn: () => rawJson<ApiEnvelope<TeamDirectory>>(`/drive/team-directories/${encodeURIComponent(id!)}`).then(r => r.data),
    enabled: !!id,
    staleTime: 5_000,
  });
}

export interface CreateTeamDirectoryInput {
  readonly name: string;
  readonly description?: string | null;
}

export function useCreateTeamDirectory(): UseMutationResult<TeamDirectory, Error, CreateTeamDirectoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => rawJson<ApiEnvelope<TeamDirectory>>("/drive/team-directories", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.teamDirectories() }),
  });
}

export interface UpdateTeamDirectoryInput {
  readonly name?: string;
  readonly description?: string | null;
}

export function useUpdateTeamDirectory(): UseMutationResult<TeamDirectory, Error, { id: string } & UpdateTeamDirectoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => rawJson<ApiEnvelope<TeamDirectory>>(`/drive/team-directories/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.teamDirectory(data.id) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.teamDirectories() });
    },
  });
}

export function useDeleteTeamDirectory(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/drive/team-directories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: driveKeys.teamDirectory(id) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.teamDirectories() });
    },
  });
}

// ── Team directory members ──

export function useDirectoryMembers(directoryId: string | undefined) {
  return useQuery({
    queryKey: driveKeys.directoryMembers(directoryId ?? ""),
    queryFn: () => rawJson<ApiEnvelope<readonly TeamDirectoryMember[]>>(`/drive/team-directories/${encodeURIComponent(directoryId!)}/members`).then(r => r.data),
    enabled: !!directoryId,
    staleTime: 5_000,
  });
}

export interface AddMemberInput {
  readonly directoryId: string;
  readonly userId: string;
  readonly role?: TeamDirectoryRole;
}

export function useAddMember(): UseMutationResult<TeamDirectoryMember, Error, AddMemberInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ directoryId, ...body }) => rawJson<ApiEnvelope<TeamDirectoryMember>>(`/drive/team-directories/${encodeURIComponent(directoryId)}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { directoryId }) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.directoryMembers(directoryId) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.teamDirectory(directoryId) });
    },
  });
}

export function useUpdateMember(): UseMutationResult<TeamDirectoryMember, Error, { directoryId: string; memberId: string; role: TeamDirectoryRole }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ directoryId, memberId, role }) => rawJson<ApiEnvelope<TeamDirectoryMember>>(
      `/drive/team-directories/${encodeURIComponent(directoryId)}/members/${encodeURIComponent(memberId)}`,
      { method: "PUT", body: JSON.stringify({ role }) },
    ).then(r => r.data),
    onSuccess: (_data, { directoryId }) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.directoryMembers(directoryId) });
    },
  });
}

export function useRemoveMember(): UseMutationResult<{ readonly id: string }, Error, { directoryId: string; memberId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ directoryId, memberId }) => rawJson<ApiEnvelope<{ readonly id: string }>>(
      `/drive/team-directories/${encodeURIComponent(directoryId)}/members/${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { directoryId }) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.directoryMembers(directoryId) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.teamDirectory(directoryId) });
    },
  });
}

// ── Edit lock & live content ──
//
// Google-style exclusive editing for spreadsheet entries: the editor
// acquires a lock on open, heartbeats it while editing, autosaves live
// content, and releases it on close/unload. Contention and lost locks
// surface as 409s the editor branches on via `err.code`:
//   - acquire      → DRIVE_EDIT_LOCKED      (another fresh lock is held)
//   - heartbeat    → DRIVE_EDIT_LOCK_STALE  (our lock expired / was taken over)
//   - live-content → DRIVE_EDIT_LOCK_STALE
//
// `httpRaw` throws `HttpError` (with `status`, the parsed envelope `code`,
// and the remaining envelope fields under `details`) on any non-2xx, so
// these hooks catch it and re-throw a typed `EditLockError` — including the
// acquire conflict's holder id `lockBy` recovered from `details`.

export interface EditLockResult {
  readonly editId: string;
  readonly lockBy: string;
  readonly lockAt: number;
  readonly takenOver: boolean;
}

export interface EditLockError extends Error {
  status: number;
  code?: string;
  lockBy?: string | null;
}

/**
 * Re-throw an error caught from `httpRaw` as a typed `EditLockError`.
 * `httpRaw` throws `HttpError` for non-2xx with `status`, the envelope
 * `code` (e.g. "DRIVE_EDIT_LOCKED" / "DRIVE_EDIT_LOCK_STALE"), and the
 * remaining envelope fields under `details` — from which the conflict
 * holder id `lockBy` is recovered (null when absent or non-HttpError).
 */
function throwLockError(err: unknown): never {
  const e = new Error(err instanceof Error ? err.message : "Edit lock request failed") as EditLockError;
  e.status = err instanceof HttpError ? err.status : 0;
  if (err instanceof HttpError && err.code !== undefined)
    e.code = err.code;
  e.lockBy = err instanceof HttpError ? ((err.details?.lockBy as string | null | undefined) ?? null) : null;
  throw e;
}

/** Acquire (or take over an expired) exclusive edit lock on an entry. */
export function useAcquireEditLock(): UseMutationResult<EditLockResult, EditLockError, { entryId: string; editId: string }> {
  return useMutation({
    mutationFn: async ({ entryId, editId }) => {
      try {
        const body = await rawJson<ApiEnvelope<EditLockResult>>(`/drive/entries/${encodeURIComponent(entryId)}/edit-lock`, {
          method: "POST",
          body: JSON.stringify({ editId }),
        });
        return body.data;
      }
      catch (err) {
        throwLockError(err);
      }
    },
  });
}

/** Refresh the lock's TTL. A 409 (DRIVE_EDIT_LOCK_STALE) means it was lost. */
export function useHeartbeatEditLock(): UseMutationResult<{ editId: string; lockAt: number }, EditLockError, { entryId: string; editId: string }> {
  return useMutation({
    mutationFn: async ({ entryId, editId }) => {
      try {
        const body = await rawJson<ApiEnvelope<{ editId: string; lockAt: number }>>(`/drive/entries/${encodeURIComponent(entryId)}/edit-lock/heartbeat`, {
          method: "PATCH",
          body: JSON.stringify({ editId }),
        });
        return body.data;
      }
      catch (err) {
        throwLockError(err);
      }
    },
  });
}

/** Release the lock held under `editId`. Safe to call when already released. */
export function useReleaseEditLock(): UseMutationResult<{ released: boolean }, Error, { entryId: string; editId: string }> {
  return useMutation({
    mutationFn: ({ entryId, editId }) => rawJson<ApiEnvelope<{ released: boolean }>>(`/drive/entries/${encodeURIComponent(entryId)}/edit-lock`, {
      method: "DELETE",
      body: JSON.stringify({ editId }),
    }).then(r => r.data),
  });
}

/**
 * Unload-safe lock release. Uses `fetch` `keepalive` (forwarded by `httpRaw`)
 * so the request survives page unload while still carrying the CSRF header
 * and credentials — unlike `navigator.sendBeacon`, which cannot send DELETE
 * with custom headers. Best-effort: failures are swallowed.
 */
export async function releaseEditLockBeacon(entryId: string, editId: string): Promise<void> {
  try {
    await httpRaw(`/drive/entries/${encodeURIComponent(entryId)}/edit-lock`, {
      method: "DELETE",
      body: JSON.stringify({ editId }),
      keepalive: true,
    });
  }
  catch {
    // Fired during unload; nothing actionable, ignore.
  }
}

/**
 * Autosave the live (in-progress) content while holding the lock. A 409
 * (DRIVE_EDIT_LOCK_STALE) means the lock was lost — the editor should go
 * read-only. Never invalidates `driveKeys`: that would clobber the live
 * editor state mid-edit.
 */
export function useUpdateEntryLiveContent(): UseMutationResult<{ id: string; updatedAt: string }, EditLockError, { entryId: string; editId: string; content: string }> {
  return useMutation({
    mutationFn: async ({ entryId, editId, content }) => {
      try {
        const body = await rawJson<ApiEnvelope<{ id: string; updatedAt: string }>>(`/drive/entries/${encodeURIComponent(entryId)}/live-content`, {
          method: "PATCH",
          body: JSON.stringify({ editId, content }),
        });
        return body.data;
      }
      catch (err) {
        throwLockError(err);
      }
    },
  });
}
