import type { Context } from "hono";
import { z } from "zod";

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
  defaults: { page?: number; limit?: number; maxLimit?: number } = {},
): PageQuery {
  const page = clampInt(c.req.query("page"), defaults.page ?? DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(c.req.query("limit"), defaults.limit ?? DEFAULT_LIMIT, 1, defaults.maxLimit ?? MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Shared zod fragment for endpoints that validate `page`/`limit` via a query
 * schema (spread into the endpoint's `z.object({...})`). Unlike
 * `parsePageQuery` (which clamps), validation REJECTS out-of-range values with
 * a 422 — both semantics predate this helper; each endpoint keeps its own.
 * The per-endpoint max limit stays an explicit argument at the call site.
 */
export function pageQueryFields(opts: { defaultLimit: number; maxLimit: number }) {
  return {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(opts.maxLimit).default(opts.defaultLimit),
  };
}

/** `pageQueryFields` variant for schemas whose `page`/`limit` stay optional. */
export function optionalPageQueryFields(maxLimit: number) {
  return {
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(maxLimit).optional(),
  };
}

function clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  if (raw === undefined || raw === "")
    return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n))
    return fallback;
  return Math.min(hi, Math.max(lo, n));
}
