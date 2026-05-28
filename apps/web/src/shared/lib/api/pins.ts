// Pin data layer: the project overview "Pin area" query plus the per-item
// pin/unpin toggles for issues and procurements.
//
// Mirrors the backend item module (apps/api/src/modules/item):
//   - GET  /projects/:projectId/pinned-items        → mixed PinnedItem[]
//   - POST /projects/:projectId/issues/:id/(un)pin   → ProjectIssueRow
//   - POST /projects/:projectId/procurements/:id/(un)pin → ProcurementRow
//
// `:projectId` is the project short id; `:id` is the item short id. Toggling
// invalidates both the affected list query and the pinned-items query so the
// overview Pin area and the row state stay in sync.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ProcurementRow } from "./procurement";
import type { ProjectIssueRow } from "./projects";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";
import { procurementKeys } from "./procurement";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

/** A pinned-item entry as rendered in the project overview Pin area. */
export interface PinnedItem {
  readonly id: string;
  readonly shortId: string;
  readonly type: "issue" | "procurement";
  readonly title: string;
  readonly status: string;
  readonly pinnedAt: string;
}

export const pinKeys = {
  pinnedItems: (projectId: string) => ["projects", projectId, "pinned-items"] as const,
};

/**
 * The mixed set of pinned issues + procurements for a project, ordered
 * `pinnedAt DESC`. Callers without `procurement.view` receive only pinned
 * issues (the backend fail-closes). Disabled when no project id is available.
 */
export function usePinnedItems(projectId: string | undefined, enabled = true) {
  return useQuery<readonly PinnedItem[]>({
    queryKey: pinKeys.pinnedItems(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly PinnedItem[]>>(
      `/projects/${encodeURIComponent(projectId!)}/pinned-items`,
    ).then(r => r.data),
    enabled: enabled && !!projectId,
    staleTime: 5_000,
  });
}

/**
 * Toggle an issue's pin state. `pin` is the desired state: `true` calls `/pin`,
 * `false` calls `/unpin`. Invalidates the project's issue lists and pinned-items.
 */
export function useToggleIssuePin(): UseMutationResult<ProjectIssueRow, Error, { projectId: string; id: string; pin: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, id, pin }) => http<ApiEnvelope<ProjectIssueRow>>(
      `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}/${pin ? "pin" : "unpin"}`,
      { method: "POST" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "issues"] });
      void queryClient.invalidateQueries({ queryKey: pinKeys.pinnedItems(projectId) });
    },
  });
}

/** Toggle a procurement's pin state. Mirrors {@link useToggleIssuePin}. */
export function useToggleProcurementPin(): UseMutationResult<ProcurementRow, Error, { projectId: string; id: string; pin: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, id, pin }) => http<ApiEnvelope<ProcurementRow>>(
      `/projects/${encodeURIComponent(projectId)}/procurements/${encodeURIComponent(id)}/${pin ? "pin" : "unpin"}`,
      { method: "POST" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: procurementKeys.byProject(projectId) });
      void queryClient.invalidateQueries({ queryKey: pinKeys.pinnedItems(projectId) });
    },
  });
}
