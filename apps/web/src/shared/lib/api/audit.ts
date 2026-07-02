// Audit-log data layer: the admin-only paginated `/audit` list (backend
// apps/api/src/modules/audit). Read-only — audit events are written
// server-side only.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export interface AuditEvent {
  readonly id: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly detail: string | null;
  readonly ip: string;
  readonly userAgent: string;
  readonly result: string;
  readonly createdAt: string;
}

interface AuditListResponse {
  success: boolean;
  data: AuditEvent[];
  meta: { total: number; page: number; limit: number };
}

export interface AuditEventsResult {
  readonly data: AuditEvent[];
  readonly meta: { readonly total: number; readonly page: number; readonly limit: number };
}

// ── Query keys ──

export const auditKeys = {
  all: ["audit"] as const,
  list: (actorId: string, action: string, result: string, page: number, limit: number) =>
    ["audit", "list", actorId, action, result, page, limit] as const,
};

// ── Queries ──

export interface AuditEventsQuery {
  readonly actorId?: string | undefined;
  // Action prefix filter, e.g. "auth.*"; empty means all actions.
  readonly action?: string | undefined;
  readonly result?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export function useAuditEvents(query: AuditEventsQuery = {}) {
  const actorId = query.actorId ?? "";
  const action = query.action ?? "";
  const result = query.result ?? "";
  const page = query.page ?? 1;
  const limit = query.limit ?? 50;
  return useQuery<AuditEventsResult>({
    queryKey: auditKeys.list(actorId, action, result, page, limit),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (actorId)
        params.set("actor_id", actorId);
      if (action)
        params.set("action", action);
      if (result)
        params.set("result", result);
      const res = await http<AuditListResponse>(`/audit?${params.toString()}`);
      return { data: res.data, meta: res.meta };
    },
    // Keep the prior page/filter rows on screen while the next query loads so
    // the log table does not flash empty on page or filter changes.
    placeholderData: keepPreviousData,
  });
}
