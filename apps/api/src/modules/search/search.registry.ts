import type { AppDatabase } from "@/db";
import type { ModuleKey } from "@/shared/modules";

export type SearchHitType = "document" | "issue" | "project" | "drive";

export interface SearchHit {
  readonly type: SearchHitType;
  // Navigation id: short_id for document/issue/project. Drive has no deep
  // link yet, so its entry id is informational only (results open `/drive`).
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  // For issue hits: the owning project's short_id, needed to deep-link into
  // the project-scoped issue route.
  readonly projectId?: string;
}

/** Read-only request context handed to every source's `search`. */
export interface SearchSourceContext {
  readonly db: AppDatabase;
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly limit: number;
}

/**
 * One searchable domain. Modules register their own source from their
 * `index.ts` as a load-time side effect (same weave as the backup registry),
 * which keeps `modules/search/` free of domain imports.
 */
export interface SearchSource {
  /** Result-group key in the `/search` payload (e.g. `"documents"`). */
  readonly key: string;
  /**
   * Module-visibility gate: a source whose module is hidden for the actor is
   * never queried and returns an empty group (PLAN-076).
   */
  readonly module: ModuleKey;
  /**
   * Permission-scoped search for one trimmed, non-empty term. Each source
   * enforces its own access scope — the fan-out adds no permission logic.
   */
  readonly search: (ctx: SearchSourceContext, query: string) => Promise<readonly SearchHit[]>;
}

const sources = new Map<string, SearchSource>();

/**
 * Register a domain's search source. A duplicate key throws: module indexes
 * run once per process, so a second registration under the same key is a
 * wiring bug (two modules claiming one result group), not re-import churn.
 */
export function registerSearchSource(source: SearchSource): void {
  if (sources.has(source.key))
    throw new Error(`Search source already registered: ${source.key}`);
  sources.set(source.key, source);
}

/** Registration-ordered sources; the search fan-out queries each one. */
export function getSearchSources(): readonly SearchSource[] {
  return [...sources.values()];
}

/** Test-only helper. Production never clears the registry. */
export function __resetSearchRegistryForTests(): void {
  sources.clear();
}
