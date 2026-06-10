// Finance data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend finance routes (apps/api/src/modules/finance). A
// finance colleague is an internal finance actor linked to exactly one
// `users` row (real or virtual); rows carry the joined user display data so
// the UI never needs per-row lookups. All routes are admin-only; DELETE
// archives instead of hard-deleting.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type FinanceColleagueStatus = "active" | "archived";

export const FINANCE_COLLEAGUE_STATUSES: readonly FinanceColleagueStatus[] = [
  "active",
  "archived",
];

// Joined user display data carried on every colleague row.
export interface FinanceColleagueUser {
  readonly name: string;
  readonly username: string;
  readonly isVirtual: boolean;
  readonly status: "active" | "disabled";
}

export interface FinanceColleagueRow {
  readonly id: string;
  readonly userId: string;
  readonly code: string | null;
  readonly title: string | null;
  readonly department: string | null;
  readonly status: FinanceColleagueStatus;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly user: FinanceColleagueUser;
}

interface FinanceColleagueListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

interface FinanceColleagueListEnvelope {
  readonly success: boolean;
  readonly data: readonly FinanceColleagueRow[];
  readonly meta: FinanceColleagueListMeta;
}

// ── Query keys ──

export const financeColleagueKeys = {
  all: ["finance", "colleagues"] as const,
  list: (query: string) => ["finance", "colleagues", "list", query] as const,
};

// ── Queries ──

export interface FinanceColleaguesQuery {
  readonly q?: string | undefined;
  readonly status?: FinanceColleagueStatus | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface FinanceColleaguesResult {
  readonly data: readonly FinanceColleagueRow[];
  readonly meta: FinanceColleagueListMeta;
}

function colleaguesQueryString(query: FinanceColleaguesQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.status)
    params.set("status", query.status);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useFinanceColleagues(query: FinanceColleaguesQuery = {}) {
  const queryString = colleaguesQueryString(query);
  return useQuery<FinanceColleaguesResult>({
    queryKey: financeColleagueKeys.list(queryString),
    queryFn: async () => {
      const res = await http<FinanceColleagueListEnvelope>(
        `/finance/colleagues?${queryString}`,
      );
      return { data: res.data, meta: res.meta };
    },
    retry: false,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export interface CreateFinanceColleagueInput {
  readonly userId: string;
  readonly code?: string;
  readonly title?: string;
  readonly department?: string;
  readonly notes?: string;
}

export function useCreateFinanceColleague(): UseMutationResult<FinanceColleagueRow, Error, CreateFinanceColleagueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<FinanceColleagueRow>>(
      "/finance/colleagues",
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeColleagueKeys.all });
    },
  });
}

export interface UpdateFinanceColleagueInput {
  readonly userId?: string;
  readonly code?: string;
  readonly title?: string;
  readonly department?: string;
  readonly notes?: string;
  readonly status?: FinanceColleagueStatus;
}

export function useUpdateFinanceColleague(): UseMutationResult<FinanceColleagueRow, Error, { id: string } & UpdateFinanceColleagueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<FinanceColleagueRow>>(
      `/finance/colleagues/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeColleagueKeys.all });
    },
  });
}

/** DELETE archives the colleague (status -> archived); it never hard-deletes. */
export function useArchiveFinanceColleague(): UseMutationResult<FinanceColleagueRow, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<FinanceColleagueRow>>(
      `/finance/colleagues/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeColleagueKeys.all });
    },
  });
}
