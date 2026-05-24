import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

// ── Types ──

export type ContactStatus = "active" | "inactive";
export type ContactVisibility = "private" | "public";

export interface ContactTagView {
  readonly id: string;
  readonly name: string;
}

export interface ContactView {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly contactPerson: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly note: string | null;
  readonly status: ContactStatus | null;
  readonly visibility: ContactVisibility;
  readonly confidential: boolean;
  readonly tags: readonly ContactTagView[];
  readonly canManage: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContactInput {
  readonly name: string;
  readonly contactPerson?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export type ContactGrantTarget
  = | { readonly userId: string; readonly groupId?: never }
    | { readonly groupId: string; readonly userId?: never };

export type ContactRevokeTarget = ContactGrantTarget;

// ── Query keys ──

export interface ContactsQuery {
  readonly tag?: string | undefined;
}

export const contactKeys = {
  all: ["contacts"] as const,
  lists: () => ["contacts", "list"] as const,
  list: (query: ContactsQuery = {}) => ["contacts", "list", query.tag ?? "all"] as const,
  detail: (id: string) => ["contacts", "detail", id] as const,
};

// ── Queries ──

export function useContacts(query: ContactsQuery = {}) {
  return useQuery({
    queryKey: contactKeys.list(query),
    queryFn: () => http<ApiEnvelope<readonly ContactView[]>>(contactsPath(query)).then(r => r.data),
    staleTime: 5_000,
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
  const qs = params.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}
