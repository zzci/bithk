import type { Context } from "hono";

/**
 * Standard `page` / `limit` pagination bounds shared across list endpoints.
 *
 * `page` is clamped to `>= 1`; `limit` is clamped to `[1, MAX_LIMIT]`.
 * Missing / non-numeric values fall back to the (overridable) defaults, so a
 * caller never has to hand-roll `Math.max(1, Math.floor(parseInt(...))) || 1`
 * boilerplate at the handler edge. The precomputed `offset` can be passed
 * straight to drizzle's `.limit(limit).offset(offset)`.
 */
export interface PageQuery {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePageQuery(
  c: Pick<Context, "req">,
  defaults: { page?: number; limit?: number } = {},
): PageQuery {
  const page = clampInt(c.req.query("page"), defaults.page ?? DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(c.req.query("limit"), defaults.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

function clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  if (raw === undefined || raw === "")
    return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n))
    return fallback;
  return Math.min(hi, Math.max(lo, n));
}
