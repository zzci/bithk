// Unified share data layer: types, raw clients, and TanStack Query hooks.
//
// Mirrors the backend `share` module (apps/api/src/modules/share). Document
// public links and drive file shares were unified into one polymorphic
// `shares` table, so a single client now serves every resource type:
//   - ShareView       ↔ ShareView       (share.service.ts)
//   - PublicShareMeta  ↔ PublicShareMeta (share.public.service.ts)
//   - ShareCapabilities ↔ capabilities adapter registry
//
// All requests go through the shared `httpRaw` client so credentials, the
// CSRF header on mutating methods, and the global `unauthorized` event stay
// consistent. Never call `fetch` directly.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { httpRaw } from "../http";
import { parseContentDispositionFilename } from "./drive";

// ── Types ──

export type ShareResourceType = "document" | "drive_entry";
export type ShareType = "direct" | "public_link";
export type SharePermission = "view" | "download" | "edit";

/**
 * A managed share row, owner/recipient facing. Mirrors the backend
 * `ShareView` exactly — the password is never serialized, only `hasPassword`.
 */
export interface ShareView {
  readonly id: string;
  readonly resourceType: ShareResourceType;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly isFolder: boolean;
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

/** Capabilities a resource type advertises for the share UI. */
export interface ShareCapabilities {
  readonly shareTypes: readonly ShareType[];
  readonly permissions: readonly SharePermission[];
}

/** Public-facing share metadata — never carries bytes or the password hash. */
export interface PublicShareMeta {
  readonly token: string;
  readonly resourceType: ShareResourceType;
  readonly name: string;
  readonly isFolder: boolean;
  readonly permission: SharePermission;
  readonly requiresPassword: boolean;
  readonly expired: boolean;
  readonly exhausted: boolean;
}

// ── Query keys ──

export const shareKeys = {
  all: ["shares"] as const,
  capabilities: (type: ShareResourceType) => ["shares", "capabilities", type] as const,
  resource: (type: ShareResourceType, id: string) => ["shares", "resource", type, id] as const,
  received: () => ["shares", "received"] as const,
  sent: () => ["shares", "sent"] as const,
  links: () => ["shares", "links"] as const,
  publicMeta: (token: string) => ["shares", "public", token] as const,
};

// ── Helpers ──

async function rawJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await httpRaw(path, init);
  return (await res.json()) as T;
}

// ── Capabilities ──

export function useShareCapabilities(type: ShareResourceType | undefined) {
  return useQuery({
    queryKey: shareKeys.capabilities(type ?? "document"),
    queryFn: () => rawJson<ApiEnvelope<ShareCapabilities>>(`/shares/capabilities/${encodeURIComponent(type!)}`).then(r => r.data),
    enabled: !!type,
    staleTime: 60_000,
  });
}

// ── Per-resource shares ──

export function useResourceShares(type: ShareResourceType | undefined, id: string | undefined) {
  return useQuery({
    queryKey: shareKeys.resource(type ?? "document", id ?? ""),
    queryFn: () => rawJson<ApiEnvelope<readonly ShareView[]>>(
      `/shares/${encodeURIComponent(type!)}/${encodeURIComponent(id!)}`,
    ).then(r => r.data),
    enabled: !!type && !!id,
    staleTime: 5_000,
  });
}

// ── Inbox / outbox lists ──

export function useReceivedShares() {
  return useQuery({
    queryKey: shareKeys.received(),
    queryFn: () => rawJson<ApiEnvelope<readonly ShareView[]>>("/shares/received").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useSentShares() {
  return useQuery({
    queryKey: shareKeys.sent(),
    queryFn: () => rawJson<ApiEnvelope<readonly ShareView[]>>("/shares/sent").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useLinkShares() {
  return useQuery({
    queryKey: shareKeys.links(),
    queryFn: () => rawJson<ApiEnvelope<readonly ShareView[]>>("/shares/links").then(r => r.data),
    staleTime: 5_000,
  });
}

// ── Mutations ──

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

/** Invalidate every list a share could appear in, plus its resource view. */
function invalidateShareViews(
  queryClient: ReturnType<typeof useQueryClient>,
  resource?: { readonly type: ShareResourceType; readonly id: string },
): void {
  void queryClient.invalidateQueries({ queryKey: shareKeys.received() });
  void queryClient.invalidateQueries({ queryKey: shareKeys.sent() });
  void queryClient.invalidateQueries({ queryKey: shareKeys.links() });
  if (resource) {
    void queryClient.invalidateQueries({ queryKey: shareKeys.resource(resource.type, resource.id) });
    return;
  }
  // Mutations that only carry a share id (revoke) can't target one resource
  // view, so refresh every open per-resource view by prefix.
  void queryClient.invalidateQueries({
    predicate: query => query.queryKey[0] === "shares" && query.queryKey[1] === "resource",
  });
}

export function useCreateShare(): UseMutationResult<
  ShareView,
  Error,
  { resourceType: ShareResourceType; resourceId: string } & CreateShareInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceType, resourceId, ...body }) => rawJson<ApiEnvelope<ShareView>>(
      `/shares/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { resourceType, resourceId }) => {
      invalidateShareViews(queryClient, { type: resourceType, id: resourceId });
    },
  });
}

export interface UpdateShareInput {
  readonly permission?: SharePermission;
  /** `undefined` keeps the password, `null` clears it, a string sets it. */
  readonly password?: string | null;
  readonly expiresAt?: string | null;
  readonly maxDownloads?: number | null;
  readonly isActive?: boolean;
}

export function useUpdateShare(): UseMutationResult<ShareView, Error, { id: string } & UpdateShareInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => rawJson<ApiEnvelope<ShareView>>(`/shares/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (data) => {
      invalidateShareViews(queryClient, { type: data.resourceType, id: data.resourceId });
    },
  });
}

export function useRevokeShare(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/shares/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => invalidateShareViews(queryClient),
  });
}

// ── Public share access (unauthenticated link) ──
//
// Mirrors the unauthenticated backend at `apps/api/src/modules/share`. These
// requests carry no session; the endpoints ignore the cookie the client
// sends, so nothing privileged leaks. Mutating POSTs still go through
// `httpRaw`, which applies the `X-Requested-With` CSRF header the global
// guard requires. Never hand-roll fetch here.

/** Absolute, copy-ready URL for a public share token. */
export function buildShareUrl(token: string): string {
  return `${window.location.origin}/shared/${encodeURIComponent(token)}`;
}

/**
 * Fetch public-link gate metadata. 404 when the token is unknown / inactive /
 * soft-deleted — the server never reveals which, so existence cannot be
 * probed. `expired` / `exhausted` are reported on the meta itself.
 */
export async function getPublicShareMeta(token: string): Promise<PublicShareMeta> {
  return rawJson<ApiEnvelope<PublicShareMeta>>(`/shared/${encodeURIComponent(token)}`).then(r => r.data);
}

export function usePublicShareMeta(token: string | undefined) {
  return useQuery({
    queryKey: shareKeys.publicMeta(token ?? ""),
    queryFn: () => getPublicShareMeta(token!),
    enabled: !!token,
    retry: false,
    staleTime: 5_000,
  });
}

// ── Resource-specific public content shapes ──

export interface PublicDriveContent {
  readonly name: string;
  readonly isFolder: boolean;
  readonly file: { readonly filename: string; readonly mimetype: string; readonly size: number } | null;
  readonly permission: SharePermission;
}

export interface PublicDocumentNode {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
}

export interface PublicDocumentAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface PublicDocumentBody {
  readonly id: string;
  readonly title: string;
  readonly content: string | null;
}

export interface PublicDocumentContent {
  readonly document: PublicDocumentBody;
  readonly attachments: readonly PublicDocumentAttachment[];
  readonly subtree: readonly PublicDocumentNode[];
}

/**
 * Access a public share's content once the optional password verifies.
 * The return shape is resource-specific (see the registry preview); callers
 * narrow it via the meta's `resourceType`. `childId` selects a descendant
 * (document subtree node by short_id) when applicable.
 */
export async function accessPublicShare<T>(
  token: string,
  opts: { readonly password?: string | undefined; readonly childId?: string | undefined } = {},
): Promise<T> {
  const payload: Record<string, string> = {};
  if (opts.password !== undefined)
    payload.password = opts.password;
  if (opts.childId !== undefined)
    payload.childId = opts.childId;
  return rawJson<ApiEnvelope<T>>(`/shared/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(r => r.data);
}

export interface PublicShareEntry {
  readonly id: string;
  readonly name: string;
  readonly type: "file" | "folder";
  readonly size: number | null;
  readonly mimetype: string | null;
}

export interface PublicShareListing {
  readonly breadcrumb: readonly { readonly id: string; readonly name: string }[];
  readonly entries: readonly PublicShareEntry[];
}

/** List entries inside a public drive folder share (subtree-scoped server-side). */
export async function listPublicShareEntries(
  token: string,
  opts: { readonly password?: string | undefined; readonly parentId?: string | undefined } = {},
): Promise<PublicShareListing> {
  const payload: Record<string, string> = {};
  if (opts.password !== undefined)
    payload.password = opts.password;
  if (opts.parentId !== undefined)
    payload.parentId = opts.parentId;
  return rawJson<ApiEnvelope<PublicShareListing>>(`/shared/${encodeURIComponent(token)}/list`, {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(r => r.data);
}

/** Fetch the bytes of a single-file drive share (root download). */
export async function fetchPublicShareFile(token: string, password?: string, signal?: AbortSignal): Promise<Response> {
  return httpRaw(`/shared/${encodeURIComponent(token)}/download`, {
    method: "POST",
    body: JSON.stringify(password !== undefined ? { password } : {}),
    ...(signal ? { signal } : {}),
  });
}

/** Fetch the bytes of a child of a share (drive folder child, or document attachment). */
export async function fetchPublicShareChild(
  token: string,
  childId: string,
  password?: string,
  signal?: AbortSignal,
): Promise<Response> {
  return httpRaw(`/shared/${encodeURIComponent(token)}/download/${encodeURIComponent(childId)}`, {
    method: "POST",
    body: JSON.stringify(password !== undefined ? { password } : {}),
    ...(signal ? { signal } : {}),
  });
}

/** Trigger a browser download from a fetched share-file response. */
async function saveResponse(res: Response, fallbackName: string): Promise<void> {
  const blob = await res.blob();
  const name = parseContentDispositionFilename(res.headers.get("content-disposition")) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Download the root file of a single-file drive share. */
export async function downloadPublicShareFile(token: string, filename: string, password?: string): Promise<void> {
  await saveResponse(await fetchPublicShareFile(token, password), filename);
}

/** Download one child file of a share (drive folder child or document attachment). */
export async function downloadPublicShareChild(
  token: string,
  childId: string,
  filename: string,
  password?: string,
): Promise<void> {
  await saveResponse(await fetchPublicShareChild(token, childId, password), filename);
}
