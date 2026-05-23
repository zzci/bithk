// Pure helpers for the command palette, split out so they can be unit-tested
// without rendering the dialog (the web suite has no DOM test harness).

import type { SearchHit } from "@/shared/lib/api/search";

export type HitTarget
  = | { readonly to: "/documents/$docId"; readonly params: { readonly docId: string } }
    | { readonly to: "/issues/$issueId"; readonly params: { readonly issueId: string } }
    | { readonly to: "/projects/$projectId"; readonly params: { readonly projectId: string } }
    | { readonly to: "/drive" };

/** Map a search hit to its router navigation target. */
export function hitTarget(hit: SearchHit): HitTarget {
  switch (hit.type) {
    case "document":
      return { to: "/documents/$docId", params: { docId: hit.id } };
    case "issue":
      return { to: "/issues/$issueId", params: { issueId: hit.id } };
    case "project":
      return { to: "/projects/$projectId", params: { projectId: hit.id } };
    case "drive":
      return { to: "/drive" };
  }
}

/** Case-insensitive label match; an empty query matches everything. */
export function matchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || label.toLowerCase().includes(q);
}
