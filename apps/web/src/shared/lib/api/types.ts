// Shared web API response envelopes — the single source of truth for the
// `{ success, data }` wrapper every backend route returns and the paginated
// `{ success, data, meta }` wrapper list routes return. Import these from the
// `api/` data-layer modules instead of re-declaring the envelope per file.

/** Success/data envelope returned by every single-resource API route. */
export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

/** Paginated list envelope: a `data` array plus pagination `meta` totals. */
export interface ApiListEnvelope<T> {
  readonly success: boolean;
  readonly data: readonly T[];
  readonly meta: { readonly total: number; readonly page: number; readonly limit: number };
}
