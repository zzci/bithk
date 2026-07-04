// Audit-log data layer: the admin-only paginated `/audit` list (backend
// apps/api/src/modules/audit). Read-only — audit events are written
// server-side only.

import type { ApiResponse, ApiRow } from "./_generated";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes are aliases of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes.
// Frontend-only types (query params) stay hand-written below.

export type AuditEvent = ApiRow<"getAudit">;

type AuditListResponse = ApiResponse<"getAudit">;

export interface AuditEventsResult {
  readonly data: readonly AuditEvent[];
  readonly meta: AuditListResponse["meta"];
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
