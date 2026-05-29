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

export type ProcurementStatus = "draft" | "requested" | "ordered" | "received" | "closed" | "cancelled";

export const PROCUREMENT_STATUSES: readonly ProcurementStatus[] = [
  "draft",
  "requested",
  "ordered",
  "received",
  "closed",
  "cancelled",
];

// Issue-parity priority levels, mirroring `issue_details.priority` exactly.
export type ProcurementPriority = "low" | "medium" | "high" | "urgent";

export const PROCUREMENT_PRIORITIES: readonly ProcurementPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
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
  // Issue-parity fields mirroring `issue_details`; priority is never null
  // (the backend defaults it to "medium").
  readonly description: string | null;
  readonly priority: ProcurementPriority;
  readonly dueDate: string | null;
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
  detail: (projectId: string, id: string) =>
    ["procurements", projectId, "detail", id] as const,
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

/**
 * Reads a single procurement by short id. Mirrors `useProjectIssue`: keyed
 * under `procurementKeys.detail` so the update mutation can prime this cache,
 * while `byProject` invalidation keeps the list in sync.
 */
export function useProcurement(projectId: string | undefined, id: string | undefined) {
  return useQuery<ProcurementRow>({
    queryKey: procurementKeys.detail(projectId ?? "", id ?? ""),
    queryFn: () => http<ApiEnvelope<ProcurementRow>>(
      `/projects/${encodeURIComponent(projectId!)}/procurements/${encodeURIComponent(id!)}`,
    ).then(r => r.data),
    enabled: !!projectId && !!id,
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
  readonly description?: string;
  readonly priority?: ProcurementPriority;
  readonly dueDate?: string;
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
  readonly description?: string | null;
  readonly priority?: ProcurementPriority;
  readonly dueDate?: string | null;
}

export function useUpdateProcurement(): UseMutationResult<ProcurementRow, Error, { projectId: string; id: string } & UpdateProcurementInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, id, ...body }) => http<ApiEnvelope<ProcurementRow>>(
      `/projects/${encodeURIComponent(projectId)}/procurements/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (data, { projectId, id }) => {
      // Prime the detail cache so the open panel reflects the change instantly,
      // then invalidate the project-scoped list/summary queries (byProject is a
      // prefix of both the list and detail keys).
      queryClient.setQueryData(procurementKeys.detail(projectId, id), data);
      void queryClient.invalidateQueries({ queryKey: procurementKeys.byProject(projectId) });
    },
  });
}

// Procurement is intentionally non-deletable (mirrors the backend, which has no
// DELETE route): retire a record by moving it to the `cancelled` status. No
// delete hook is exposed.

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
