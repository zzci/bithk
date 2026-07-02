// Favorites data layer (FEAT-048): the per-user favorites pinned on the
// overview workbench plus its cross-project aggregates.
//
// Mirrors the backend overview module (apps/api/src/modules/overview):
//   - GET    /favorites            → hydrated FavoriteItem[]
//   - PUT    /favorites/:type/:id  → favorite a target (404 when not visible)
//   - DELETE /favorites/:type/:id  → idempotent unfavorite
//   - GET    /overview             → { myIssues, openProcurements }
//
// `:id` is the target's short id (project or item). Starred state everywhere
// derives from the favorites query, so toggling only invalidates `favorites`.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ProcurementStatus } from "./procurement";
import type { IssueStatus, ProjectStatus } from "./projects";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

export type FavoriteTargetType = "project" | "issue" | "procurement";

export interface FavoriteProjectItem {
  readonly targetType: "project";
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly status: ProjectStatus;
  readonly favoritedAt: string;
}

export interface FavoriteIssueItem {
  readonly targetType: "issue";
  readonly id: string;
  readonly title: string;
  readonly status: IssueStatus;
  readonly priority: string;
  readonly dueDate: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly favoritedAt: string;
}

export interface FavoriteProcurementItem {
  readonly targetType: "procurement";
  readonly id: string;
  readonly itemName: string;
  readonly status: ProcurementStatus;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly favoritedAt: string;
}

export type FavoriteItem = FavoriteProjectItem | FavoriteIssueItem | FavoriteProcurementItem;

export interface OverviewIssueRow {
  readonly id: string;
  readonly title: string;
  readonly status: IssueStatus;
  readonly priority: string;
  readonly dueDate: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly updatedAt: string;
}

export interface OverviewProcurementRow {
  readonly id: string;
  readonly itemName: string;
  readonly status: ProcurementStatus;
  readonly priority: string;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly dueDate: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly updatedAt: string;
}

export interface OverviewData {
  readonly myIssues: readonly OverviewIssueRow[];
  readonly openProcurements: readonly OverviewProcurementRow[];
}

export const favoriteKeys = {
  list: ["favorites"] as const,
  overview: ["overview"] as const,
};

/** The caller's favorites, hydrated and visibility-checked server-side. */
export function useFavorites(enabled = true) {
  return useQuery<readonly FavoriteItem[]>({
    queryKey: favoriteKeys.list,
    queryFn: () => http<ApiEnvelope<readonly FavoriteItem[]>>("/favorites").then(r => r.data),
    enabled,
    staleTime: 5_000,
  });
}

/** Cross-project workbench aggregates (my issues, open procurements). */
export function useOverview(enabled = true) {
  return useQuery<OverviewData>({
    queryKey: favoriteKeys.overview,
    queryFn: () => http<ApiEnvelope<OverviewData>>("/overview").then(r => r.data),
    enabled,
    staleTime: 5_000,
  });
}

/**
 * Toggle a favorite. `favorite` is the desired state: `true` PUTs, `false`
 * DELETEs. Only the favorites query is invalidated — starred state everywhere
 * derives from it.
 */
export function useToggleFavorite(): UseMutationResult<void, Error, { targetType: FavoriteTargetType; id: string; favorite: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetType, id, favorite }) => {
      await http<ApiEnvelope<{ favorited: boolean }>>(
        `/favorites/${targetType}/${encodeURIComponent(id)}`,
        { method: favorite ? "PUT" : "DELETE" },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: favoriteKeys.list });
    },
  });
}

/** Convenience: membership test over the favorites list for star toggles. */
export function useFavoriteSet(enabled = true): { has: (targetType: FavoriteTargetType, id: string) => boolean; isLoading: boolean } {
  const { data, isLoading } = useFavorites(enabled);
  const keys = new Set((data ?? []).map(f => `${f.targetType}:${f.id}`));
  return { has: (targetType, id) => keys.has(`${targetType}:${id}`), isLoading };
}
