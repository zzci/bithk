// HR payroll data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend HR payroll routes (apps/api/src/modules/hr). One
// record per colleague per `YYYY-MM` period; amounts are integers in the
// currency's minor unit and the net amount is computed server-side. The
// pending -> paid transition is one-way and paid records are immutable
// (mutations return 409). All routes are admin-only.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type HrPayrollStatus = "pending" | "paid";

export const HR_PAYROLL_STATUSES: readonly HrPayrollStatus[] = [
  "pending",
  "paid",
];

// Joined colleague display data carried on every payroll row.
export interface HrPayrollColleague {
  readonly name: string;
  readonly username: string;
  readonly isVirtual: boolean;
}

export interface HrPayrollRow {
  readonly id: string;
  readonly colleagueId: string;
  readonly period: string;
  readonly baseSalary: number;
  readonly bonus: number;
  readonly deduction: number;
  readonly currency: string;
  readonly netAmount: number;
  readonly status: HrPayrollStatus;
  readonly paidAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly colleague: HrPayrollColleague;
}

// Per-currency net total across the ENTIRE filtered set (not just the page),
// computed server-side and carried on the list meta.
export interface HrPayrollNetTotal {
  readonly currency: string;
  readonly net: number;
}

interface HrPayrollListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
  readonly totals: readonly HrPayrollNetTotal[];
}

interface HrPayrollListEnvelope {
  readonly success: boolean;
  readonly data: readonly HrPayrollRow[];
  readonly meta: HrPayrollListMeta;
}

// ── Query keys ──

export const hrPayrollKeys = {
  all: ["hr", "payroll"] as const,
  list: (query: string) => ["hr", "payroll", "list", query] as const,
};

// ── Queries ──

export interface HrPayrollQuery {
  readonly colleagueId?: string | undefined;
  readonly period?: string | undefined;
  readonly status?: HrPayrollStatus | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface HrPayrollResult {
  readonly data: readonly HrPayrollRow[];
  readonly meta: HrPayrollListMeta;
}

function payrollQueryString(query: HrPayrollQuery): string {
  const params = new URLSearchParams();
  if (query.colleagueId)
    params.set("colleagueId", query.colleagueId);
  if (query.period)
    params.set("period", query.period);
  if (query.status)
    params.set("status", query.status);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useHrPayrollRecords(query: HrPayrollQuery = {}) {
  const queryString = payrollQueryString(query);
  return useQuery<HrPayrollResult>({
    queryKey: hrPayrollKeys.list(queryString),
    queryFn: async () => {
      const res = await http<HrPayrollListEnvelope>(
        `/hr/payroll?${queryString}`,
      );
      return { data: res.data, meta: res.meta };
    },
    retry: false,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export interface CreateHrPayrollInput {
  readonly colleagueId: string;
  readonly period: string;
  readonly baseSalary: number;
  readonly bonus?: number;
  readonly deduction?: number;
  readonly currency: string;
  readonly notes?: string;
}

export function useCreateHrPayrollRecord(): UseMutationResult<HrPayrollRow, Error, CreateHrPayrollInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<HrPayrollRow>>(
      "/hr/payroll",
      { method: "POST", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrPayrollKeys.all });
    },
  });
}

export interface UpdateHrPayrollInput {
  readonly colleagueId?: string;
  readonly period?: string;
  readonly baseSalary?: number;
  readonly bonus?: number;
  readonly deduction?: number;
  readonly currency?: string;
  readonly notes?: string;
  /** Only the one-way pending -> paid transition is accepted. */
  readonly status?: "paid";
}

/** Only pending records are editable; paid records return 409. */
export function useUpdateHrPayrollRecord(): UseMutationResult<HrPayrollRow, Error, { id: string } & UpdateHrPayrollInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<HrPayrollRow>>(
      `/hr/payroll/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrPayrollKeys.all });
    },
  });
}

export interface GeneratePayrollInput {
  readonly period: string;
}

export interface GeneratePayrollResult {
  readonly created: number;
  readonly skipped: number;
}

/**
 * One-click monthly generation (admin-only). Creates a pending record for
 * every active colleague with a configured salary that has no record for the
 * period; idempotent. Invalidates the payroll list so the new rows appear.
 */
export function useGeneratePayroll(): UseMutationResult<GeneratePayrollResult, Error, GeneratePayrollInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ period }) => http<ApiEnvelope<GeneratePayrollResult>>(
      "/hr/payroll/generate",
      { method: "POST", body: JSON.stringify({ period }) },
    ).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrPayrollKeys.all });
    },
  });
}

/** Deletes a pending record; paid records are immutable history. */
export function useDeleteHrPayrollRecord(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<unknown>>(
      `/hr/payroll/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrPayrollKeys.all });
    },
  });
}
