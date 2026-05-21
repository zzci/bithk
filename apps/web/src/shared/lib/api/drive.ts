// Drive data layer: types, raw clients, and TanStack Query hooks.
//
// Mirrors the backend drive module (apps/api/src/modules/drive). Every
// response shape matches the corresponding service view exactly:
//   - DriveEntry        ↔ DriveEntryView      (drive.service.ts)
//   - DriveFileVersion  ↔ DriveVersionView    (drive.version.service.ts)
//   - DriveShare        ↔ DriveShareView      (drive.share.service.ts)
//   - PublicShareMetadata ↔ PublicShareMeta   (drive.share.service.ts)
//   - TeamDirectory     ↔ TeamDirectoryView   (drive.team-directory.service.ts)
//   - TeamDirectoryMember ↔ team_directory_members row
//
// All requests go through the shared `httpRaw` client so credentials, the
// CSRF header on mutating methods, and the global `unauthorized` event stay
// consistent. Never call `fetch` directly.

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpRaw } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

// ── Types ──

export type DriveOwnerType = "user" | "team_directory";
export type DriveEntryType = "folder" | "file";
export type DriveEntryStatus = "normal" | "trash";
export type ShareType = "direct" | "public_link";
export type SharePermission = "view" | "download" | "edit";
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

export interface DriveShare {
  readonly id: string;
  readonly driveEntryId: string;
  readonly entryName: string;
  readonly token: string;
  readonly shareType: ShareType;
  readonly sharedWithUserId: string | null;
  readonly permission: SharePermission;
  readonly hasPassword: boolean;
  readonly expiresAt: string | null;
  readonly maxDownloads: number | null;
  readonly downloadCount: number;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file: {
    readonly filename: string;
    readonly mimetype: string;
    readonly size: number;
  } | null;
}

/** Public-facing share metadata — never carries bytes or the password hash. */
export interface PublicShareMetadata {
  readonly token: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly permission: SharePermission;
  readonly requiresPassword: boolean;
  readonly expired: boolean;
  readonly exhausted: boolean;
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
  entries: (query: DriveEntriesQuery) => [
    "drive",
    "entries",
    query.ownerType ?? "user",
    query.ownerId ?? "self",
    query.parentEntryId ?? "root",
    query.status ?? "normal",
  ] as const,
  recent: () => ["drive", "entries", "recent"] as const,
  favorites: () => ["drive", "entries", "favorites"] as const,
  versions: (entryId: string) => ["drive", "entries", entryId, "versions"] as const,
  entryShares: (entryId: string) => ["drive", "entries", entryId, "shares"] as const,
  receivedShares: () => ["drive", "shares", "received"] as const,
  sentShares: () => ["drive", "shares", "sent"] as const,
  links: () => ["drive", "shares", "links"] as const,
  teamDirectories: () => ["drive", "team-directories"] as const,
  teamDirectory: (id: string) => ["drive", "team-directories", id] as const,
  directoryMembers: (id: string) => ["drive", "team-directories", id, "members"] as const,
  publicShare: (token: string) => ["drive", "shared", token] as const,
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

// ── Shares ──

export type CreateShareInput
  = | {
    readonly shareType: "direct";
    readonly sharedWithUserId: string;
    readonly permission: SharePermission;
  }
  | {
    readonly shareType: "public_link";
    readonly permission?: SharePermission;
    readonly password?: string;
    readonly expiresAt?: string;
    readonly maxDownloads?: number;
  };

export function useEntryShares(entryId: string | undefined) {
  return useQuery({
    queryKey: driveKeys.entryShares(entryId ?? ""),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveShare[]>>(`/drive/entries/${encodeURIComponent(entryId!)}/shares`).then(r => r.data),
    enabled: !!entryId,
    staleTime: 5_000,
  });
}

export function useCreateShare(): UseMutationResult<DriveShare, Error, { entryId: string } & CreateShareInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, ...body }) => rawJson<ApiEnvelope<DriveShare>>(`/drive/entries/${encodeURIComponent(entryId)}/shares`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { entryId }) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.entryShares(entryId) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.sentShares() });
      void queryClient.invalidateQueries({ queryKey: driveKeys.links() });
    },
  });
}

export interface UpdateShareInput {
  readonly permission?: SharePermission;
  readonly password?: string | null;
  readonly expiresAt?: string | null;
  readonly maxDownloads?: number | null;
  readonly isActive?: boolean;
}

export function useUpdateShare(): UseMutationResult<DriveShare, Error, { id: string } & UpdateShareInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => rawJson<ApiEnvelope<DriveShare>>(`/drive/shares/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.entryShares(data.driveEntryId) });
      void queryClient.invalidateQueries({ queryKey: driveKeys.sentShares() });
      void queryClient.invalidateQueries({ queryKey: driveKeys.links() });
      void queryClient.invalidateQueries({ queryKey: driveKeys.receivedShares() });
    },
  });
}

export function useRevokeShare(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/drive/shares/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.sentShares() });
      void queryClient.invalidateQueries({ queryKey: driveKeys.links() });
      void queryClient.invalidateQueries({ queryKey: driveKeys.receivedShares() });
    },
  });
}

export function useReceivedShares() {
  return useQuery({
    queryKey: driveKeys.receivedShares(),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveShare[]>>("/drive/shares/received").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useSentShares() {
  return useQuery({
    queryKey: driveKeys.sentShares(),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveShare[]>>("/drive/shares/sent").then(r => r.data),
    staleTime: 5_000,
  });
}

export function usePublicLinks() {
  return useQuery({
    queryKey: driveKeys.links(),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveShare[]>>("/drive/shares/links").then(r => r.data),
    staleTime: 5_000,
  });
}

// ── Public share access (unauthenticated link) ──

export type PublicShareAccess
  = | { readonly kind: "view"; readonly meta: PublicShareMetadata }
    | { readonly kind: "download"; readonly blob: Blob; readonly filename: string };

/**
 * Fetch public-link metadata. Routed through the shared client like every
 * other request; the endpoint requires no session, and the server ignores
 * the cookie the client sends, so no privileged data leaks.
 */
export async function getPublicShare(token: string): Promise<PublicShareMetadata> {
  return rawJson<ApiEnvelope<PublicShareMetadata>>(`/drive/shared/${encodeURIComponent(token)}`).then(r => r.data);
}

export function usePublicShare(token: string | undefined) {
  return useQuery({
    queryKey: driveKeys.publicShare(token ?? ""),
    queryFn: () => getPublicShare(token!),
    enabled: !!token,
    staleTime: 5_000,
  });
}

/**
 * Access a public link: verifies the optional password server-side, then
 * either returns view-only metadata or a downloadable blob. The two cases are
 * distinguished by the presence of a `Content-Disposition` header (set only
 * on the streamed file response).
 */
export async function accessPublicShare(token: string, password?: string): Promise<PublicShareAccess> {
  const res = await httpRaw(`/drive/shared/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify(password !== undefined ? { password } : {}),
  });
  const disposition = res.headers.get("content-disposition");
  if (disposition) {
    const blob = await res.blob();
    return {
      kind: "download",
      blob,
      filename: parseContentDispositionFilename(disposition) ?? token,
    };
  }
  const body = await res.json() as ApiEnvelope<PublicShareMetadata>;
  return { kind: "view", meta: body.data };
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
