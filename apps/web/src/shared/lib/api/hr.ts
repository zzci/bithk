// HR data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend HR routes (apps/api/src/modules/hr). A
// HR colleague is an internal staff member linked to exactly one
// `users` row (real or virtual); rows carry the joined user display data so
// the UI never needs per-row lookups. All routes are admin-only; DELETE
// archives instead of hard-deleting.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiResponse, ApiRow } from "./_generated";
import type { ApiEnvelope } from "./types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes are aliases of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes.
// Frontend-only types (inputs, query params) stay hand-written below.

// One colleague row from GET /hr/colleagues — carries the joined user display
// data so the UI never needs per-row lookups.
export type HrColleagueRow = ApiRow<"getHrColleagues">;

export type HrColleagueStatus = HrColleagueRow["status"];

export const HR_COLLEAGUE_STATUSES: readonly HrColleagueStatus[] = [
  "active",
  "archived",
];

export type HrGender = NonNullable<HrColleagueRow["gender"]>;

export const HR_GENDERS: readonly HrGender[] = ["male", "female", "other", "undisclosed"];

export type HrEmploymentType = NonNullable<HrColleagueRow["employmentType"]>;

export const HR_EMPLOYMENT_TYPES: readonly HrEmploymentType[] = [
  "full_time",
  "part_time",
  "contract",
  "intern",
];

// One user-defined receiving-account field (label/value); rendered as a
// repeatable row so each country's payment details can differ.
export type HrPaymentField = HrColleagueRow["paymentInfo"][number];

// One emergency contact; a colleague can list several.
export type HrEmergencyContact = HrColleagueRow["emergencyContacts"][number];

// Joined user display data carried on every colleague row.
export type HrColleagueUser = HrColleagueRow["user"];

type HrColleagueListMeta = ApiResponse<"getHrColleagues">["meta"];

// Distinct department / work-location values over the whole colleague table,
// from GET /hr/colleagues/facets — feeds the list filter dropdowns.
export type HrColleagueFacets = ApiResponse<"getHrColleaguesFacets">["data"];

// ── Query keys ──

export const hrColleagueKeys = {
  all: ["hr", "colleagues"] as const,
  list: (query: string) => ["hr", "colleagues", "list", query] as const,
  facets: () => ["hr", "colleagues", "facets"] as const,
};

// ── Queries ──

export interface HrColleaguesQuery {
  readonly q?: string | undefined;
  readonly status?: HrColleagueStatus | undefined;
  readonly employmentType?: HrEmploymentType | undefined;
  readonly department?: string | undefined;
  readonly workLocation?: string | undefined;
  readonly hireDateFrom?: string | undefined;
  readonly hireDateTo?: string | undefined;
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
  if (query.employmentType)
    params.set("employmentType", query.employmentType);
  if (query.department)
    params.set("department", query.department);
  if (query.workLocation)
    params.set("workLocation", query.workLocation);
  if (query.hireDateFrom)
    params.set("hireDateFrom", query.hireDateFrom);
  if (query.hireDateTo)
    params.set("hireDateTo", query.hireDateTo);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useHrColleagues(query: HrColleaguesQuery = {}) {
  const queryString = colleaguesQueryString(query);
  return useQuery<HrColleaguesResult>({
    queryKey: hrColleagueKeys.list(queryString),
    queryFn: async () => {
      const res = await http<ApiResponse<"getHrColleagues">>(
        `/hr/colleagues?${queryString}`,
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

export function useHrColleagueFacets() {
  return useQuery<HrColleagueFacets>({
    queryKey: hrColleagueKeys.facets(),
    queryFn: async () => {
      const res = await http<ApiResponse<"getHrColleaguesFacets">>("/hr/colleagues/facets");
      return res.data;
    },
    retry: false,
    staleTime: 5_000,
  });
}

// ── Mutations ──

// Shared optional profile fields. Enums accept `null` to clear a selection;
// the JSON arrays are sent in full when present.
export interface HrColleagueProfileInput {
  readonly code?: string;
  readonly title?: string;
  readonly department?: string;
  readonly notes?: string;
  readonly birthday?: string;
  readonly hireDate?: string;
  readonly probationEndDate?: string;
  readonly contractEndDate?: string;
  readonly gender?: HrGender | null;
  readonly employmentType?: HrEmploymentType | null;
  readonly nationality?: string;
  readonly personalPhone?: string;
  readonly personalEmail?: string;
  readonly address?: string;
  readonly workLocation?: string;
  readonly salaryAmount?: number | null;
  readonly salaryCurrency?: string | null;
  readonly paymentInfo?: readonly HrPaymentField[];
  readonly emergencyContacts?: readonly HrEmergencyContact[];
}

export interface CreateHrColleagueInput extends HrColleagueProfileInput {
  readonly userId: string;
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

export interface UpdateHrColleagueInput extends HrColleagueProfileInput {
  readonly userId?: string;
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
