// Documents data layer: types, raw clients, and TanStack Query hooks.
//
// 409 (VERSION_CONFLICT) is a load-bearing case for the immersive editor —
// the API returns the current row in `body.data` so the caller can rebase
// without losing the user's in-flight edits. The shared `http()` discards
// that payload, so the patch helper here uses `httpRaw()` and parses the
// envelope itself to surface the conflict row via `DocumentVersionConflictError`.

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { HttpError, httpRaw } from "../http";

// ── Types ──

export interface Document {
  readonly id: string;
  readonly title: string;
  readonly content: string | null;
  readonly tags: string;
  readonly parentId: string | null;
  readonly version: number;
  /**
   * When true, new comments are rejected by the API (admin/creator
   * bypass). Existing comments stay visible.
   */
  readonly commentsLocked: boolean;
  readonly creatorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DocumentTreeNode {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly updatedAt: string;
  readonly childCount: number;
}

export interface SimpleUser {
  readonly id: string;
  readonly name: string;
  readonly username: string;
}

export interface SimpleGroup {
  readonly id: string;
  readonly name: string;
}

export interface DocumentShare {
  readonly id: string;
  readonly documentId: string;
  readonly targetType: "user" | "group";
  readonly targetId: string;
  readonly permission: "viewer" | "editor";
  readonly createdAt: string;
  // null when the share is on this document directly; otherwise the
  // ancestor document this grant is inherited from. Inherited shares
  // cannot be removed from the current doc's share dialog — the user
  // must go to the source document instead.
  readonly inheritedFrom: { readonly id: string; readonly title: string } | null;
}

/**
 * View-only public-link grant on a document. Mirrors the backend
 * `DocumentPublicLinkView` (document.share.service.ts) exactly — the
 * password hash is never serialized, only `hasPassword`.
 */
export interface DocumentPublicLink {
  readonly id: string;
  readonly documentId: string;
  readonly token: string;
  readonly hasPassword: boolean;
  readonly expiresAt: string | null;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Attachment {
  readonly id: string;
  readonly documentId: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

// ── Helpers ──

export function parseTags(tagsJson: string | null | undefined): string[] {
  if (!tagsJson)
    return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed : [];
  }
  catch {
    return [];
  }
}

// ── Raw clients ──

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly meta?: { readonly total: number; readonly page: number; readonly limit: number };
}

/**
 * Documents needs the full envelope (`success` + `data` + `meta`) for
 * a couple of routes — `http()` strips it down to `data`. Build it on
 * top of `httpRaw()` so CSRF / credentials / event emission stay
 * consistent with the rest of the SPA.
 */
async function rawJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await httpRaw(path, init);
  return (await res.json()) as T;
}

/**
 * Thrown by {@link patchDocument} when the server reports VERSION_CONFLICT (409).
 * `.current` is the freshly-read row the caller should rebase on.
 */
export class DocumentVersionConflictError extends Error {
  readonly current: Document;
  constructor(current: Document) {
    super("Document version conflict");
    this.name = "DocumentVersionConflictError";
    this.current = current;
  }
}

interface UpdatePayload {
  readonly title?: string;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly parentId?: string | null;
  readonly commentsLocked?: boolean;
  readonly version: number;
}

export async function patchDocument(id: string, payload: UpdatePayload): Promise<Document> {
  // VERSION_CONFLICT is the one error path that needs the full envelope:
  // the API embeds the freshly-read row in `body.data` so the editor can
  // rebase. `httpRaw` throws HttpError for other 4xx/5xx; we intercept
  // the 409 case, parse the envelope, and re-throw the typed conflict
  // error before the generic throw fires.
  try {
    const res = await httpRaw(`/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    const body = await res.json() as ApiEnvelope<Document>;
    return body.data;
  }
  catch (err) {
    if (err instanceof HttpError && err.status === 409 && err.code === "VERSION_CONFLICT") {
      // Refetch the current row so the editor can rebase. We discarded
      // the envelope inside httpRaw; one extra GET keeps the error
      // surface narrow and avoids special-casing httpRaw.
      const current = await rawJson<ApiEnvelope<Document>>(`/documents/${id}`);
      throw new DocumentVersionConflictError(current.data);
    }
    throw err;
  }
}

// ── Query keys ──

export const documentsKeys = {
  all: ["documents"] as const,
  tree: () => ["documents", "tree"] as const,
  detail: (id: string) => ["documents", "detail", id] as const,
  tags: () => ["documents", "tags"] as const,
  users: () => ["documents", "users"] as const,
  groups: () => ["documents", "groups"] as const,
  shares: (id: string) => ["documents", id, "shares"] as const,
  publicLinks: (id: string) => ["documents", id, "public-links"] as const,
  attachments: (id: string) => ["documents", id, "attachments"] as const,
  comments: (id: string) => ["documents", id, "comments"] as const,
  publicShare: (token: string) => ["documents", "shared", token] as const,
};

// ── Query hooks ──

export function useDocumentTree() {
  return useQuery({
    queryKey: documentsKeys.tree(),
    queryFn: () => rawJson<ApiEnvelope<readonly DocumentTreeNode[]>>("/documents/tree").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: documentsKeys.detail(id ?? ""),
    queryFn: () => rawJson<ApiEnvelope<Document>>(`/documents/${id}`).then(r => r.data),
    enabled: !!id,
    staleTime: 5_000,
  });
}

export function useDocumentTags() {
  return useQuery({
    queryKey: documentsKeys.tags(),
    queryFn: () => rawJson<ApiEnvelope<readonly string[]>>("/documents/tags").then(r => r.data),
    staleTime: 30_000,
  });
}

export function useDocumentUsers() {
  return useQuery({
    queryKey: documentsKeys.users(),
    queryFn: () => rawJson<ApiEnvelope<readonly SimpleUser[]>>("/documents/users").then(r => r.data),
    staleTime: 60_000,
  });
}

export function useDocumentGroups() {
  return useQuery({
    queryKey: documentsKeys.groups(),
    queryFn: () => rawJson<ApiEnvelope<readonly SimpleGroup[]>>("/documents/groups").then(r => r.data),
    staleTime: 60_000,
  });
}

// ── Mutation hooks ──

interface CreateDocumentInput {
  readonly title: string;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly parentId?: string | null;
}

export function useCreateDocument(): UseMutationResult<Document, Error, CreateDocumentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDocumentInput) => {
      const res = await rawJson<ApiEnvelope<Document>>("/documents", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentsKeys.tree() });
    },
  });
}

export interface UpdateDocumentInput {
  readonly id: string;
  readonly version: number;
  readonly title?: string;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly parentId?: string | null;
  readonly commentsLocked?: boolean;
}

/**
 * Optimistic update with rollback on failure. On 409 we restore the
 * pre-mutation snapshot rather than installing the server row: reseeding
 * the cache would bump `version` and make the detail view discard the
 * user's unsaved draft. The typed {@link DocumentVersionConflictError}
 * still propagates so the caller can warn the user and preserve the draft.
 */
export function useUpdateDocument(): UseMutationResult<Document, Error, UpdateDocumentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateDocumentInput) => {
      return patchDocument(id, payload);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: documentsKeys.detail(input.id) });
      const previous = qc.getQueryData<Document>(documentsKeys.detail(input.id));
      if (previous) {
        qc.setQueryData<Document>(documentsKeys.detail(input.id), {
          ...previous,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.tags !== undefined ? { tags: JSON.stringify(input.tags) } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.commentsLocked !== undefined ? { commentsLocked: input.commentsLocked } : {}),
        });
      }
      return { previous };
    },
    onError: (_err, input, ctx) => {
      // Always restore the pre-mutation snapshot — including on
      // VERSION_CONFLICT. Installing the server row here would change
      // `version` and trigger the detail view to reseed its draft,
      // silently discarding the user's unsaved edits. The component's
      // onError surfaces the conflict and keeps the draft instead.
      if (ctx?.previous) {
        qc.setQueryData(documentsKeys.detail(input.id), ctx.previous);
      }
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentsKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: documentsKeys.tree() });
      void qc.invalidateQueries({ queryKey: documentsKeys.tags() });
    },
  });
}

export function useDeleteDocument(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await rawJson<ApiEnvelope<null>>(`/documents/${id}`, { method: "DELETE" });
    },
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: documentsKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: documentsKeys.tree() });
    },
  });
}

export function useMoveDocument(): UseMutationResult<Document, Error, { readonly id: string; readonly parentId: string | null; readonly version: number }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, parentId, version }) => {
      const res = await rawJson<ApiEnvelope<Document>>(`/documents/${id}/move`, {
        method: "PATCH",
        body: JSON.stringify({ parentId, version }),
      });
      return res.data;
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentsKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: documentsKeys.tree() });
    },
  });
}

// ── Public links (owner-only management) ──
//
// `:id` in these routes is the document short_id (the same value the
// rest of the documents client passes as `doc.id`). Mutations go through
// `rawJson`/`httpRaw`, so credentials and the `X-Requested-With` CSRF
// header are applied automatically — never hand-roll fetch here.

export function useDocumentPublicLinks(docId: string | undefined) {
  return useQuery({
    queryKey: documentsKeys.publicLinks(docId ?? ""),
    queryFn: () => rawJson<ApiEnvelope<readonly DocumentPublicLink[]>>(`/documents/${docId}/public-links`).then(r => r.data),
    enabled: !!docId,
    staleTime: 5_000,
  });
}

export interface CreateDocumentPublicLinkInput {
  readonly docId: string;
  readonly password?: string;
  readonly expiresAt?: string | null;
}

export function useCreateDocumentPublicLink(): UseMutationResult<DocumentPublicLink, Error, CreateDocumentPublicLinkInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docId, ...body }) => {
      const res = await rawJson<ApiEnvelope<DocumentPublicLink>>(`/documents/${docId}/public-links`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (_data, { docId }) => {
      void qc.invalidateQueries({ queryKey: documentsKeys.publicLinks(docId) });
    },
  });
}

export interface UpdateDocumentPublicLinkInput {
  readonly docId: string;
  readonly linkId: string;
  /** `undefined` keeps the password, `null` clears it, a string sets it. */
  readonly password?: string | null;
  readonly expiresAt?: string | null;
  readonly isActive?: boolean;
}

export function useUpdateDocumentPublicLink(): UseMutationResult<DocumentPublicLink, Error, UpdateDocumentPublicLinkInput> {
  const qc = useQueryClient();
  return useMutation({
    // `undefined` fields are dropped by JSON.stringify, so an omitted
    // `password` reaches the server as "keep" while an explicit `null`
    // clears it — matching the backend PATCH contract.
    mutationFn: async ({ docId, linkId, ...body }) => {
      const res = await rawJson<ApiEnvelope<DocumentPublicLink>>(`/documents/${docId}/public-links/${linkId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (_data, { docId }) => {
      void qc.invalidateQueries({ queryKey: documentsKeys.publicLinks(docId) });
    },
  });
}

export function useRevokeDocumentPublicLink(): UseMutationResult<void, Error, { readonly docId: string; readonly linkId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docId, linkId }) => {
      await rawJson<ApiEnvelope<null>>(`/documents/${docId}/public-links/${linkId}`, { method: "DELETE" });
    },
    onSuccess: (_data, { docId }) => {
      void qc.invalidateQueries({ queryKey: documentsKeys.publicLinks(docId) });
    },
  });
}

// ── Public share access (unauthenticated viewer) ──
//
// Mirrors the unauthenticated backend at
// `apps/api/src/modules/document/document.public.routes.ts`. These
// requests carry no session; the endpoints ignore the cookie the client
// sends, so nothing privileged leaks. Mutating POSTs still go through
// `httpRaw`, which applies the `X-Requested-With` CSRF header the global
// guard requires. Never hand-roll fetch here.

/** Gate metadata for a public document link — enough to render the prompt. */
export interface PublicDocumentMeta {
  readonly token: string;
  readonly title: string;
  readonly hasPassword: boolean;
}

/** A node in the link's shared subtree (root reports `parentId: null`). */
export interface PublicSubtreeNode {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
}

/** One attachment on a shared document — never carries bytes. */
export interface PublicDocumentAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
}

/** Full payload returned once a public link's password (if any) is verified. */
export interface PublicDocumentContent {
  readonly token: string;
  readonly hasPassword: boolean;
  readonly document: Document;
  readonly attachments: readonly PublicDocumentAttachment[];
  readonly subtree: readonly PublicSubtreeNode[];
}

/**
 * Fetch public-link gate metadata (title + whether a password is needed).
 * 404 when the token is unknown / inactive / expired / soft-deleted —
 * the server never reveals which, so existence cannot be probed.
 */
export async function getPublicDocument(token: string): Promise<PublicDocumentMeta> {
  return rawJson<ApiEnvelope<PublicDocumentMeta>>(`/documents/shared/${encodeURIComponent(token)}`).then(r => r.data);
}

export function usePublicDocument(token: string | undefined) {
  return useQuery({
    queryKey: documentsKeys.publicShare(token ?? ""),
    queryFn: () => getPublicDocument(token!),
    enabled: !!token,
    retry: false,
    staleTime: 5_000,
  });
}

/**
 * Access a shared document's content. Verifies the optional password
 * server-side (403 on missing/wrong) then returns the addressed document
 * with its attachments and the navigable subtree. `docId` selects a
 * descendant short_id; omit it for the link's root document.
 */
export async function accessPublicDocument(
  token: string,
  opts: { readonly password?: string | undefined; readonly docId?: string | undefined } = {},
): Promise<PublicDocumentContent> {
  const payload: Record<string, string> = {};
  if (opts.password !== undefined)
    payload.password = opts.password;
  if (opts.docId !== undefined)
    payload.docId = opts.docId;
  return rawJson<ApiEnvelope<PublicDocumentContent>>(`/documents/shared/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(r => r.data);
}

/**
 * Fetch one attachment from a shared document. Image / PDF types are
 * opened inline in a new tab for preview; everything else triggers a
 * browser download. The owning document is validated against the link's
 * subtree server-side, so an out-of-subtree `aid` cannot be pulled.
 */
export async function openPublicDocumentAttachment(
  token: string,
  attachment: PublicDocumentAttachment,
  password?: string,
): Promise<void> {
  const inline = attachment.mimetype.startsWith("image/") || attachment.mimetype === "application/pdf";
  const res = await httpRaw(
    `/documents/shared/${encodeURIComponent(token)}/attachments/${encodeURIComponent(attachment.id)}${inline ? "?inline=true" : ""}`,
    {
      method: "POST",
      body: JSON.stringify(password !== undefined ? { password } : {}),
    },
  );
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (inline) {
    // Open the preview in a new tab; revoke late so the tab can load it.
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachment.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
