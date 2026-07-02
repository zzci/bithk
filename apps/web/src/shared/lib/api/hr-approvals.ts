// HR approvals data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend HR approval routes (apps/api/src/modules/hr). An
// approval request is filed for a colleague and decided exactly once:
// pending -> approved/rejected is one-way and decided records are immutable
// (mutations return 409). All routes are admin-only.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type HrApprovalStatus = "pending" | "approved" | "rejected";

export const HR_APPROVAL_STATUSES: readonly HrApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
];

export type HrApprovalType = "leave" | "overtime" | "business_trip" | "other";

export const HR_APPROVAL_TYPES: readonly HrApprovalType[] = [
  "leave",
  "overtime",
  "business_trip",
  "other",
];

// Joined applicant display data carried on every approval row.
export interface HrApprovalApplicant {
  readonly name: string;
  readonly username: string;
  readonly isVirtual: boolean;
}

export interface HrApprovalRow {
  readonly id: string;
  readonly colleagueId: string;
  readonly type: HrApprovalType;
  readonly title: string;
  readonly reason: string | null;
  readonly status: HrApprovalStatus;
  readonly decisionNote: string | null;
  readonly decidedAt: string | null;
  readonly decidedByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly applicant: HrApprovalApplicant;
}

interface HrApprovalListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

interface HrApprovalListEnvelope {
  readonly success: boolean;
  readonly data: readonly HrApprovalRow[];
  readonly meta: HrApprovalListMeta;
}

// ── Query keys ──

export const hrApprovalKeys = {
  all: ["hr", "approvals"] as const,
  list: (query: string) => ["hr", "approvals", "list", query] as const,
};

// ── Queries ──

export interface HrApprovalsQuery {
  readonly q?: string | undefined;
  readonly status?: HrApprovalStatus | undefined;
  readonly type?: HrApprovalType | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface HrApprovalsResult {
  readonly data: readonly HrApprovalRow[];
  readonly meta: HrApprovalListMeta;
}

function approvalsQueryString(query: HrApprovalsQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.status)
    params.set("status", query.status);
  if (query.type)
    params.set("type", query.type);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useHrApprovals(query: HrApprovalsQuery = {}) {
  const queryString = approvalsQueryString(query);
  return useQuery<HrApprovalsResult>({
    queryKey: hrApprovalKeys.list(queryString),
    queryFn: async () => {
      const res = await http<HrApprovalListEnvelope>(
        `/hr/approvals?${queryString}`,
      );
      return { data: res.data, meta: res.meta };
    },
    // Keep the prior page/filter rows on screen while the next query loads so
    // the list does not flash empty on page or filter changes.
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export interface CreateHrApprovalInput {
  readonly colleagueId: string;
  readonly type: HrApprovalType;
  readonly title: string;
  readonly reason?: string;
}

export function useCreateHrApproval(): UseMutationResult<HrApprovalRow, Error, CreateHrApprovalInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<HrApprovalRow>>(
      "/hr/approvals",
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrApprovalKeys.all });
    },
  });
}

export interface UpdateHrApprovalInput {
  readonly colleagueId?: string;
  readonly type?: HrApprovalType;
  readonly title?: string;
  readonly reason?: string;
}

/** Only pending requests are editable; decided records return 409. */
export function useUpdateHrApproval(): UseMutationResult<HrApprovalRow, Error, { id: string } & UpdateHrApprovalInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<HrApprovalRow>>(
      `/hr/approvals/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrApprovalKeys.all });
    },
  });
}

export interface DecideHrApprovalInput {
  readonly id: string;
  readonly status: "approved" | "rejected";
  readonly note?: string;
}

/** One-way: only pending requests can be decided, exactly once. */
export function useDecideHrApproval(): UseMutationResult<HrApprovalRow, Error, DecideHrApprovalInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<HrApprovalRow>>(
      `/hr/approvals/${encodeURIComponent(id)}/decision`,
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrApprovalKeys.all });
    },
  });
}

/** Withdraws a pending request; decided records are immutable history. */
export function useDeleteHrApproval(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<unknown>>(
      `/hr/approvals/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrApprovalKeys.all });
    },
  });
}
