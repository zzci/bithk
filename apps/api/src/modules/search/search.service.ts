import type { SearchHit } from "./search.registry";
import type { AppDatabase } from "@/db";
import type { ModuleKey } from "@/shared/modules";
import { getSearchSources } from "./search.registry";

export type { SearchHit, SearchHitType } from "./search.registry";

export interface GlobalSearchParams {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly q: string;
  readonly limit: number;
  /**
   * The actor's visible modules (`resolveUserModules` output — admins get
   * every key there). Hidden-module domains are not queried and return
   * empty groups, mirroring the route-level module gate (PLAN-076).
   */
  readonly modules: readonly ModuleKey[];
}

/**
 * Result groups keyed by registered source key — `documents` / `issues` /
 * `projects` / `drive` / `ships` with every searchable module loaded. A
 * module that never registered a source is absent, not empty.
 */
export type GlobalSearchResult = Readonly<Record<string, readonly SearchHit[]>>;

/**
 * Fan out a single query term to each registered source's permission-scoped
 * search and collect the uniform hit groups. No new permission logic: every
 * source enforces its own access scope, and a hidden-module domain (e.g.
 * issues, which live under the `projects` module — same registry prefix
 * mapping as the route gate) is simply never queried.
 */
export async function globalSearch(db: AppDatabase, params: GlobalSearchParams): Promise<GlobalSearchResult> {
  const { userId, isAdmin, q, limit, modules } = params;
  const term = q.trim();
  const ctx = { db, userId, isAdmin, limit };

  const groups = await Promise.all(getSearchSources().map(async (source) => {
    const hits = term.length > 0 && modules.includes(source.module)
      ? await source.search(ctx, term)
      : [];
    return [source.key, hits] as const;
  }));

  return Object.fromEntries(groups);
}
