// Global search data layer: types and the TanStack Query hook backing the
// command palette. The endpoint returns hits already permission-scoped by the
// API; the client only renders and navigates.

import type { ApiEnvelope } from "./types";
import { useQuery } from "@tanstack/react-query";
import { http } from "../http";

type SearchHitType = "document" | "issue" | "project" | "drive" | "ship";

export interface SearchHit {
  readonly type: SearchHitType;
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  // For issue hits: the owning project's short_id, used to deep-link into the
  // project-scoped issue route.
  readonly projectId?: string;
}

export interface GlobalSearchResult {
  readonly documents: readonly SearchHit[];
  readonly issues: readonly SearchHit[];
  readonly projects: readonly SearchHit[];
  readonly drive: readonly SearchHit[];
  readonly ships: readonly SearchHit[];
}

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
