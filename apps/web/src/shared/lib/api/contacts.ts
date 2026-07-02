import type { UseMutationResult } from "@tanstack/react-query";
import type { ProjectTag } from "./projects";
import type { ApiEnvelope, ApiListEnvelope } from "./types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type ContactKind = "individual" | "organization";
export type ContactStatus = "active" | "inactive";
export type ContactVisibility = "private" | "public";

// Collapsed 3-state derived from (visibility, confidential) for the list filter
// and UI badge. public = public/non-confidential; private = private/non-confidential;
// confidential = private/confidential.
export type ContactSensitivity = "public" | "private" | "confidential";

interface ContactListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

interface ContactTagView {
  readonly id: string;
  readonly name: string;
}

// Embedded company summary for an individual's linked organization. Sensitive
// fields are nulled by the backend when the reading actor may not see the org's
// confidential fields; `name` is always present. Null for organization rows and
// for individuals with no org link.
export interface ContactOrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly website: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
}

export interface ContactView {
  readonly id: string;
  readonly kind: ContactKind;
  readonly ownerId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  // Masked like phone/email when the actor may not see confidential fields.
  readonly website: string | null;
  readonly position: string | null;
  // The linked employer (individuals only); `organizationName` is the resolved
  // name of that organization, supplied by the API for display.
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  // Embedded company summary of the linked organization (individuals only);
  // null for organization rows and for individuals with no org link.
  readonly organization: ContactOrganizationSummary | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly note: string | null;
  // Free-form flat string→string custom properties (null when none).
  readonly attributes: Record<string, string> | null;
  // Avatar (person) / logo (organization): the file_references id plus the
  // resolved inline content URL the UI renders in an <img>.
  readonly avatarReferenceId: string | null;
  readonly avatarUrl: string | null;
  readonly categoryId: string | null;
  readonly status: ContactStatus | null;
  readonly visibility: ContactVisibility;
  readonly confidential: boolean;
  readonly tags: readonly ContactTagView[];
  readonly canManage: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Company fields used to seed an organization created inline from
// `organizationName`. Only meaningful alongside `organizationName`; ignored when
// linking an existing `organizationId` or when no org link is requested.
export interface ContactOrganizationAttributes {
  readonly website?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
}

export interface ContactInput {
  // Defaults to 'organization' on the backend when omitted; the create form
  // always supplies it. Immutable after create (the update form omits it).
  readonly kind?: ContactKind | undefined;
  readonly name: string;
  // Shared by both kinds: phone, email, website, taxId, address, note.
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly position?: string | null | undefined;
  // Link to an existing organization, or pass `organizationName` to create one
  // on the fly and link to it. `organizationAttributes` seeds company fields
  // onto that inline-created organization and only applies in that case.
  readonly organizationId?: string | null | undefined;
  readonly organizationName?: string | null | undefined;
  readonly organizationAttributes?: ContactOrganizationAttributes | undefined;
  readonly taxId?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly attributes?: Record<string, string> | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly categoryId?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
}

export type ContactGrantTarget
  = | { readonly userId: string; readonly groupId?: never }
    | { readonly groupId: string; readonly userId?: never };

export type ContactRevokeTarget = ContactGrantTarget;

// ── Query keys ──

export interface ContactsQuery {
  readonly tag?: string | undefined;
  // Optional party-kind filter for the flat list; omitted ⇒ all kinds (no
  // behaviour change for the supplier picker, which calls `useContacts()`).
  readonly kind?: ContactKind | undefined;
}

export const contactKeys = {
  all: ["contacts"] as const,
  lists: () => ["contacts", "list"] as const,
  list: (query: ContactsQuery = {}) => ["contacts", "list", query.tag ?? "all", query.kind ?? "all"] as const,
  pagedList: (query: string) => ["contacts", "pagedList", query] as const,
  detail: (id: string) => ["contacts", "detail", id] as const,
};

// Selectable contact-tag vocabulary cache key (type=contact). Mirrors
// `procurementTagKeys` / `issueTagKeys`.
export const contactTagKeys = {
  vocabulary: ["tags", "contact"] as const,
};

// ── Queries ──

export function useContacts(query: ContactsQuery = {}) {
  return useQuery({
    queryKey: contactKeys.list(query),
    // Unwraps the paginated envelope but ignores `meta`: omitting `page` makes
    // the backend return the full visible set, preserving the flat-array
    // contract the supplier pickers depend on.
    queryFn: () => http<ApiListEnvelope<ContactView>>(contactsPath(query)).then(r => r.data),
    staleTime: 5_000,
  });
}

export interface ContactsListQuery {
  readonly q?: string | undefined;
  // Party-kind filter: all kinds when omitted, else only individuals or orgs.
  readonly kind?: ContactKind | undefined;
  readonly status?: ContactStatus | undefined;
  readonly categoryId?: string | undefined;
  // Collapsed visibility/confidential filter (single-select).
  readonly sensitivity?: ContactSensitivity | undefined;
  // Union (OR) filter: a contact matches when it carries ANY of these tag ids.
  readonly tagIds?: readonly string[] | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ContactsListResult {
  readonly data: readonly ContactView[];
  readonly meta: ContactListMeta;
}

function contactsQueryString(query: ContactsListQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.kind)
    params.set("kind", query.kind);
  if (query.status)
    params.set("status", query.status);
  if (query.categoryId)
    params.set("categoryId", query.categoryId);
  if (query.sensitivity)
    params.set("sensitivity", query.sensitivity);
  // Repeatable tagId params; sorted so the cache key stays stable regardless of
  // selection order (the backend union semantics are order-independent).
  if (query.tagIds && query.tagIds.length > 0) {
    for (const tagId of [...query.tagIds].sort())
      params.append("tagIds", tagId);
  }
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useContactsList(query: ContactsListQuery = {}) {
  const queryString = contactsQueryString(query);
  return useQuery<ContactsListResult>({
    queryKey: contactKeys.pagedList(queryString),
    queryFn: async () => {
      const res = await http<ApiListEnvelope<ContactView>>(`/contacts?${queryString}`);
      return { data: res.data, meta: res.meta };
    },
    // Keep the prior page/filter rows on screen while the next query loads so
    // the list does not flash empty on page or filter changes.
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

// Selectable contact-tag vocabulary (type=contact), usage-count ordered.
// Drives the contact list multi-select tag filter. Mirrors `useProcurementTags`.
export function useContactTags() {
  return useQuery<readonly ProjectTag[]>({
    queryKey: contactTagKeys.vocabulary,
    queryFn: () => http<ApiEnvelope<readonly ProjectTag[]>>("/tags?type=contact").then(r => r.data),
    staleTime: 30_000,
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: contactKeys.detail(id ?? ""),
    queryFn: () => http<ApiEnvelope<ContactView>>(`/contacts/${encodeURIComponent(id!)}`).then(r => r.data),
    enabled: !!id,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export function useCreateContact(): UseMutationResult<ContactView, Error, ContactInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<ContactView>>("/contacts", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      // A created contact may introduce new tag names into the vocabulary, which
      // is a sibling of `["contacts"]` and so is not covered by `contactKeys.all`.
      void queryClient.invalidateQueries({ queryKey: contactTagKeys.vocabulary });
    },
  });
}

export function useUpdateContact(): UseMutationResult<ContactView, Error, { id: string } & Partial<ContactInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<ContactView>>(
      `/contacts/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: contactKeys.detail(id) });
      // An updated tag set may introduce new tag names into the sibling vocabulary.
      void queryClient.invalidateQueries({ queryKey: contactTagKeys.vocabulary });
    },
  });
}

export function useDeleteContact(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<{ readonly id: string }>>(
      `/contacts/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: contactKeys.detail(id) });
    },
  });
}

// Set / replace a contact's avatar (person) or logo (organization). Mirrors
// `useSetProjectCover`: a multipart POST carrying the image file.
export function useSetContactAvatar(): UseMutationResult<ContactView, Error, { id: string; file: File }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      return http<ApiEnvelope<ContactView>>(`/contacts/${encodeURIComponent(id)}/avatar`, {
        method: "POST",
        body: fd,
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

// Remove a contact's avatar/logo (no-op server-side when it has none).
export function useRemoveContactAvatar(): UseMutationResult<ContactView, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<ContactView>>(`/contacts/${encodeURIComponent(id)}/avatar`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

export function useGrantContact(): UseMutationResult<{
  readonly id: string;
  readonly target: { readonly type: "user" | "group"; readonly id: string };
}, Error, { id: string } & ContactGrantTarget> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<{
      readonly id: string;
      readonly target: { readonly type: "user" | "group"; readonly id: string };
    }>>(
      `/contacts/${encodeURIComponent(id)}/grant`,
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: contactKeys.detail(id) });
    },
  });
}

export function useRevokeContact(): UseMutationResult<{
  readonly id: string;
  readonly target: { readonly type: "user" | "group"; readonly id: string };
  readonly revoked: boolean;
}, Error, { id: string } & ContactRevokeTarget> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<{
      readonly id: string;
      readonly target: { readonly type: "user" | "group"; readonly id: string };
      readonly revoked: boolean;
    }>>(
      `/contacts/${encodeURIComponent(id)}/revoke`,
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: contactKeys.detail(id) });
    },
  });
}

function contactsPath(query: ContactsQuery): string {
  const params = new URLSearchParams();
  if (query.tag)
    params.set("tag", query.tag);
  if (query.kind)
    params.set("kind", query.kind);
  const qs = params.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}
