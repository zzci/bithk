// Global search data layer: types and the TanStack Query hook backing the
// command palette. The endpoint returns hits already permission-scoped by the
// API; the client only renders and navigates.

import type { ApiData } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useQuery } from "@tanstack/react-query";
import { http } from "../http";

// Server view shapes are aliases of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.

export type GlobalSearchResult = ApiData<"getSearch">;

// Every result bucket carries the same hit shape; for issue hits `projectId`
// is the owning project's short_id, used to deep-link into the project-scoped
// issue route.
export type SearchHit = GlobalSearchResult["documents"][number];

/**
 * Fetch global search results for a trimmed query. Disabled while the query is
 * empty so the palette shows quick entries instead of firing a request.
 */
export function useGlobalSearch(query: string) {
  const q = query.trim();
  return useQuery<GlobalSearchResult>({
    queryKey: ["search", q],
    enabled: q.length > 0,
    queryFn: async () => {
      const res = await http<ApiEnvelope<GlobalSearchResult>>(`/search?q=${encodeURIComponent(q)}`);
      return res.data;
    },
    staleTime: 10_000,
  });
}
