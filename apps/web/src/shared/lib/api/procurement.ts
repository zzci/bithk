// Procurement data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend procurement routes (apps/api/src/modules/project).
// Procurement is scoped under a project (by shortId) and is visibility
// fail-closed: callers without access get 403/404, which the UI surfaces by
// hiding the tab. All ids are shortIds.

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

interface ApiListEnvelope<T> {
  readonly success: boolean;
  readonly data: readonly T[];
  readonly meta: { readonly total: number; readonly page: number; readonly limit: number };
}

// ── Types ──

export type ProcurementStatus = "draft" | "requested" | "ordered" | "received" | "closed";

export const PROCUREMENT_STATUSES: readonly ProcurementStatus[] = [
  "draft",
  "requested",
  "ordered",
  "received",
  "closed",
];

export interface ProcurementRow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly itemName: string;
  readonly status: ProcurementStatus;
  readonly supplierId: string | null;
  readonly categoryId: string | null;
  readonly assigneeMemberId: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly creatorId: string;
  // Pin state from the shared item base; mirrors ProjectIssueRow.
  readonly pinned: boolean;
  readonly pinnedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ProcurementListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

// ── Query keys ──

export const procurementKeys = {
  all: ["procurements"] as const,
  list: (projectId: string, query: string) =>
    ["procurements", projectId, "list", query] as const,
  byProject: (projectId: string) => ["procurements", projectId] as const,
};

// ── Queries ──

export interface ProcurementsQuery {
  readonly status?: ProcurementStatus | undefined;
  readonly categoryId?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ProcurementsResult {
  readonly data: readonly ProcurementRow[];
  readonly meta: ProcurementListMeta;
}

export function useProcurements(
  projectId: string | undefined,
  query: ProcurementsQuery = {},
  enabled = true,
) {
  const status = query.status;
  const categoryId = query.categoryId;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const params = new URLSearchParams();
  if (status)
    params.set("status", status);
  if (categoryId)
    params.set("categoryId", categoryId);
  params.set("page", String(page));
  params.set("limit", String(limit));
  const queryString = params.toString();
  return useQuery<ProcurementsResult>({
    queryKey: procurementKeys.list(projectId ?? "", queryString),
    queryFn: async () => {
      const res = await http<ApiListEnvelope<ProcurementRow>>(
        `/projects/${encodeURIComponent(projectId!)}/procurements?${queryString}`,
      );
      return { data: res.data, meta: res.meta };
    },
    enabled: enabled && !!projectId,
    retry: false,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export interface CreateProcurementInput {
  readonly itemName: string;
  readonly title?: string;
  readonly status?: ProcurementStatus;
  readonly supplierId?: string;
  readonly categoryId?: string;
  readonly assigneeMemberId?: string;
  readonly quantity?: number;
  readonly amount?: number;
  readonly currency?: string;
}

export function useCreateProcurement(): UseMutationResult<ProcurementRow, Error, { projectId: string } & CreateProcurementInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProcurementRow>>(
      `/projects/${encodeURIComponent(projectId)}/procurements`,
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: procurementKeys.byProject(projectId) });
    },
  });
}

export interface UpdateProcurementInput {
  readonly itemName?: string;
  readonly title?: string | null;
  readonly supplierId?: string | null;
  readonly categoryId?: string | null;
  readonly assigneeMemberId?: string | null;
  readonly quantity?: number | null;
  readonly amount?: number | null;
  readonly currency?: string | null;
}

export function useUpdateProcurement(): UseMutationResult<ProcurementRow, Error, { projectId: string; id: string } & UpdateProcurementInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, id, ...body }) => http<ApiEnvelope<ProcurementRow>>(
      `/projects/${encodeURIComponent(projectId)}/procurements/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: procurementKeys.byProject(projectId) });
    },
  });
}

export function useDeleteProcurement(): UseMutationResult<null, Error, { projectId: string; id: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, id }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/procurements/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: procurementKeys.byProject(projectId) });
    },
  });
}

export function useChangeProcurementStatus(): UseMutationResult<ProcurementRow, Error, { projectId: string; id: string; status: ProcurementStatus }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, id, status }) => http<ApiEnvelope<ProcurementRow>>(
      `/projects/${encodeURIComponent(projectId)}/procurements/${encodeURIComponent(id)}/status`,
      { method: "POST", body: JSON.stringify({ status }) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: procurementKeys.byProject(projectId) });
    },
  });
}
