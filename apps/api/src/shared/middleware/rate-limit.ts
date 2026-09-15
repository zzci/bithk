import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { createMiddleware } from "hono/factory";
import { getClientIp } from "@/shared/lib/client-ip";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Max requests per IP per window. */
  readonly max: number;
  /** Logical bucket id; share between routes that should drain the same budget. */
  readonly bucket: string;
}

export interface RateLimitHit {
  /** Logical bucket id; share between routes that should drain the same budget. */
  readonly bucket: string;
  /** What the budget is counted against — an IP, an actor id, … */
  readonly key: string;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Max hits per key per window. */
  readonly max: number;
}

/**
 * Hard cap on entries per bucket; on overflow the entry with the smallest
 *  `resetAt` is evicted so legitimate active sessions are preserved.
 */
const MAX_ENTRIES_PER_BUCKET = 10_000;

const buckets = new Map<string, Map<string, Bucket>>();
let smallestWindowMs = Number.POSITIVE_INFINITY;
let gcTimer: ReturnType<typeof setInterval> | undefined;

function getBucketMap(name: string): Map<string, Bucket> {
  let map = buckets.get(name);
  if (!map) {
    map = new Map();
    buckets.set(name, map);
  }
  return map;
}

/** Drop expired entries from every bucket. Run by the background GC timer. */
function pruneExpired(now: number): void {
  for (const map of buckets.values()) {
    for (const [key, val] of map) {
      if (now >= val.resetAt)
        map.delete(key);
    }
  }
}

/**
 * Evict the entry with the smallest `resetAt` (closest to expiry) to make
 *  room for a new one when a bucket has hit `MAX_ENTRIES_PER_BUCKET`.
 */
function evictOldest(map: Map<string, Bucket>): void {
  let oldestKey: string | undefined;
  let oldestResetAt = Number.POSITIVE_INFINITY;
  for (const [key, val] of map) {
    if (val.resetAt < oldestResetAt) {
      oldestResetAt = val.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined)
    map.delete(oldestKey);
}

/**
 * Lazily start (or re-tune) the background GC sweep. The interval is
 *  bounded by the smallest configured `windowMs` across all buckets so an
 *  expired entry is never alive for more than one window past its reset.
 */
function ensureGcTimer(windowMs: number): void {
  if (windowMs >= smallestWindowMs && gcTimer)
    return;

  smallestWindowMs = Math.min(smallestWindowMs, windowMs);

  if (gcTimer)
    clearInterval(gcTimer);

  gcTimer = setInterval(() => pruneExpired(Date.now()), smallestWindowMs);
  // Don't keep the event loop alive solely for the GC sweep.
  gcTimer.unref?.();
}

/**
 * Per-IP rate limiter. Uses the resolved client IP (peer IP by default, or
 * sanitised proxy headers when `config.TRUST_PROXY` is true); unresolved
 * peers share a single `anon` bucket to prevent header churn from evading
 * the gate. Bucket by something else — an actor, say — with
 * `consumeRateLimit` directly.
 *
 * Pruning is performed by a single background `setInterval` (one timer total,
 * `unref()`'d, period bounded by the smallest configured window) instead of
 * an inline O(n) sweep on the request path.
 */
export function rateLimit(opts: RateLimitOptions) {
  const { windowMs, max, bucket } = opts;
  ensureGcTimer(windowMs);

  return createMiddleware<AppEnv>(async (c, next) => {
    const key = getClientIp(c, c.var.config) ?? "anon";
    const retryAfter = consumeRateLimit({ bucket, key, windowMs, max });
    if (retryAfter > 0)
      return rateLimited(c, retryAfter);
    return next();
  });
}

/**
 * Count one hit against `bucket` for `key`. Returns 0 when the hit is allowed,
 * otherwise the seconds remaining until the window resets — so a caller that
 * needs several budgets (the write limiter charges a per-minute and a per-hour
 * bucket) can check them itself instead of nesting middleware.
 */
export function consumeRateLimit({ bucket, key, windowMs, max }: RateLimitHit): number {
  const map = getBucketMap(bucket);
  ensureGcTimer(windowMs);
  const now = Date.now();
  const entry = map.get(key);

  if (entry && now < entry.resetAt) {
    if (entry.count >= max)
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    entry.count++;
    return 0;
  }

  if (map.size >= MAX_ENTRIES_PER_BUCKET)
    evictOldest(map);
  map.set(key, { count: 1, resetAt: now + windowMs });
  return 0;
}

/** The shared 429 envelope: `Retry-After` plus the `RATE_LIMITED` error code. */
export function rateLimited(c: Context<AppEnv>, retryAfterSeconds: number): Response {
  c.header("Retry-After", String(retryAfterSeconds));
  return c.json(
    { success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } },
    429,
  );
}

/**
 * Test-only: drop all in-memory bucket state. Call from `beforeEach` in tests
 * that exercise rate-limited routes so leftover hits from the previous case
 * do not bleed into the next one (the `getClientIp("anon")` fallback shares
 * a bucket across all synthetic Requests).
 */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = undefined;
  }
  smallestWindowMs = Number.POSITIVE_INFINITY;
}
