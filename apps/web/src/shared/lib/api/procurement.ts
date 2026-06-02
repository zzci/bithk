// Procurement data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend procurement routes (apps/api/src/modules/project).
// Procurement is scoped under a project (by shortId) and is visibility
// fail-closed: callers without access get 403/404, which the UI surfaces by
// hiding the tab. All ids are shortIds.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ProjectTag } from "./projects";
import type { ApiEnvelope, ApiListEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type ProcurementStatus = "requested" | "ordered" | "confirmed" | "in_transit" | "received" | "accepted" | "cancelled";

export const PROCUREMENT_STATUSES: readonly ProcurementStatus[] = [
  "requested",
  "ordered",
  "confirmed",
  "in_transit",
  "received",
  "accepted",
  "cancelled",
];

// Tag reference carried on procurement rows and detail (name resolved by the
// API). Mirrors `IssueTagRef` (type='procurement').
export interface ProcurementTagRef {
  readonly id: string;
  readonly name: string;
}

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
  // Assigned tags (type='procurement'), resolved by the API.
  readonly tags: readonly ProcurementTagRef[];
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

// Selectable procurement-tag vocabulary cache key (type=procurement).
export const procurementTagKeys = {
  vocabulary: ["tags", "procurement"] as const,
};

// ── Queries ──

export interface ProcurementsQuery {
  readonly q?: string | undefined;
  readonly status?: ProcurementStatus | undefined;
  readonly priority?: ProcurementPriority | undefined;
  readonly categoryId?: string | undefined;
  // Union (OR) filter: a procurement matches when it carries ANY of these tag ids.
  readonly tagIds?: readonly string[] | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ProcurementsResult {
  readonly data: readonly ProcurementRow[];
  readonly meta: ProcurementListMeta;
}

function procurementsQueryString(query: ProcurementsQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.status)
    params.set("status", query.status);
  if (query.priority)
    params.set("priority", query.priority);
  if (query.categoryId)
    params.set("categoryId", query.categoryId);
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

export function useProcurements(
  projectId: string | undefined,
  query: ProcurementsQuery = {},
  enabled = true,
) {
  const queryString = procurementsQueryString(query);
  return useQuery<ProcurementsResult>({
    queryKey: procurementKeys.list(projectId ?? "", queryString),
    queryFn: async () => {
      const res = await http<ApiListEnvelope<ProcurementRow>>(
        `/projects/${encodeURIComponent(projectId!)}/procurements?${queryString}`,
      );
      // Normalize at the boundary: coerce `tags` to an array so a contract-
      // violating or stale-cache row can never reach the UI without one.
      return { data: res.data.map(r => ({ ...r, tags: r.tags ?? [] })), meta: res.meta };
    },
    enabled: enabled && !!projectId,
    retry: false,
    staleTime: 5_000,
  });
}

// Selectable procurement-tag vocabulary (type=procurement), usage-count ordered.
// Drives the procurement list multi-select tag filter. Mirrors `useIssueTags`.
export function useProcurementTags() {
  return useQuery<readonly ProjectTag[]>({
    queryKey: procurementTagKeys.vocabulary,
    queryFn: () => http<ApiEnvelope<readonly ProjectTag[]>>("/tags?type=procurement").then(r => r.data),
    staleTime: 30_000,
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
  // Optional tag names (type='procurement') synced with the procurement.
  readonly tags?: readonly string[];
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
      // A created procurement may introduce new tag names into the vocabulary.
      void queryClient.invalidateQueries({ queryKey: procurementTagKeys.vocabulary });
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
  // Replacement tag set (type='procurement'); omit to leave tags unchanged.
  readonly tags?: readonly string[];
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
      // An updated tag set may introduce new tag names into the vocabulary.
      void queryClient.invalidateQueries({ queryKey: procurementTagKeys.vocabulary });
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
