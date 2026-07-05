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
import type { ApiData, ApiRow } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// Server view shapes are aliases of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.

type FavoriteRow = ApiRow<"getFavorites">;

export type FavoriteProjectItem = Extract<FavoriteRow, { targetType: "project" }>;
export type FavoriteIssueItem = Extract<FavoriteRow, { targetType: "issue" }>;
export type FavoriteProcurementItem = Extract<FavoriteRow, { targetType: "procurement" }>;

export type FavoriteItem = FavoriteProjectItem | FavoriteIssueItem | FavoriteProcurementItem;
export type FavoriteTargetType = FavoriteItem["targetType"];

export type OverviewData = ApiData<"getOverview">;

export type OverviewIssueRow = OverviewData["myIssues"][number];
export type OverviewProcurementRow = OverviewData["openProcurements"][number];

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
