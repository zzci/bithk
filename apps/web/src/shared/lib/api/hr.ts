// HR data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend HR routes (apps/api/src/modules/hr). A
// HR colleague is an internal staff member linked to exactly one
// `users` row (real or virtual); rows carry the joined user display data so
// the UI never needs per-row lookups. All routes are admin-only; DELETE
// archives instead of hard-deleting.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type HrColleagueStatus = "active" | "archived";

export const HR_COLLEAGUE_STATUSES: readonly HrColleagueStatus[] = [
  "active",
  "archived",
];

// Joined user display data carried on every colleague row.
export interface HrColleagueUser {
  readonly name: string;
  readonly username: string;
  readonly isVirtual: boolean;
  readonly status: "active" | "disabled";
}

export interface HrColleagueRow {
  readonly id: string;
  readonly userId: string;
  readonly code: string | null;
  readonly title: string | null;
  readonly department: string | null;
  readonly status: HrColleagueStatus;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly user: HrColleagueUser;
}

interface HrColleagueListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

interface HrColleagueListEnvelope {
  readonly success: boolean;
  readonly data: readonly HrColleagueRow[];
  readonly meta: HrColleagueListMeta;
}

// ── Query keys ──

export const hrColleagueKeys = {
  all: ["hr", "colleagues"] as const,
  list: (query: string) => ["hr", "colleagues", "list", query] as const,
};

// ── Queries ──

export interface HrColleaguesQuery {
  readonly q?: string | undefined;
  readonly status?: HrColleagueStatus | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface HrColleaguesResult {
  readonly data: readonly HrColleagueRow[];
  readonly meta: HrColleagueListMeta;
}

function colleaguesQueryString(query: HrColleaguesQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.status)
    params.set("status", query.status);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useHrColleagues(query: HrColleaguesQuery = {}) {
  const queryString = colleaguesQueryString(query);
  return useQuery<HrColleaguesResult>({
    queryKey: hrColleagueKeys.list(queryString),
    queryFn: async () => {
      const res = await http<HrColleagueListEnvelope>(
        `/hr/colleagues?${queryString}`,
      );
      return { data: res.data, meta: res.meta };
    },
    retry: false,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export interface CreateHrColleagueInput {
  readonly userId: string;
  readonly code?: string;
  readonly title?: string;
  readonly department?: string;
  readonly notes?: string;
}

export function useCreateHrColleague(): UseMutationResult<HrColleagueRow, Error, CreateHrColleagueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<HrColleagueRow>>(
      "/hr/colleagues",
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrColleagueKeys.all });
    },
  });
}

export interface UpdateHrColleagueInput {
  readonly userId?: string;
  readonly code?: string;
  readonly title?: string;
  readonly department?: string;
  readonly notes?: string;
  readonly status?: HrColleagueStatus;
}

export function useUpdateHrColleague(): UseMutationResult<HrColleagueRow, Error, { id: string } & UpdateHrColleagueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<HrColleagueRow>>(
      `/hr/colleagues/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrColleagueKeys.all });
    },
  });
}

/** DELETE archives the colleague (status -> archived); it never hard-deletes. */
export function useArchiveHrColleague(): UseMutationResult<HrColleagueRow, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<HrColleagueRow>>(
      `/hr/colleagues/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrColleagueKeys.all });
    },
  });
}
