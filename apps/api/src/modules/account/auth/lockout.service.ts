import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { eq } from "drizzle-orm";
import { authLockouts } from "./schema";

/**
 * Persistent counter + lockout window. Backs the per-username brute-force
 * defence for single-user login and the per-user TOTP step-up. Stored in
 * SQLite so:
 *
 *   - a deliberate restart does not reset the counter;
 *   - replicas sharing one DB see the same state;
 *   - operators can audit / clear lockouts with a regular SQL session.
 *
 * The key namespace is caller-defined ("single-user:<username-lower>",
 * "totp:<user-id>", …). Callers pass thresholds + windows so this
 * module stays policy-free.
 */

export interface LockoutPolicy {
  /** Failures required before the bucket transitions to `locked`. */
  threshold: number;
  /** Lockout duration in milliseconds once threshold is reached. */
  windowMs: number;
}

export interface LockoutState {
  locked: boolean;
  retryAfterSeconds: number;
}

const UNLOCKED: LockoutState = { locked: false, retryAfterSeconds: 0 };

/** Returns the current lock state without mutating the row. */
export async function isLocked(db: AppDatabase, key: string): Promise<LockoutState> {
  const row = await db.select().from(authLockouts).where(eq(authLockouts.key, key)).get();
  if (!row || row.lockedUntil === null)
    return UNLOCKED;
  const remaining = row.lockedUntil - Date.now();
  if (remaining <= 0) {
    // TTL elapsed — clear the row lazily so the next read is a fast hit.
    await db.delete(authLockouts).where(eq(authLockouts.key, key));
    return UNLOCKED;
  }
  return { locked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

/**
 * Record a failed attempt. If the counter would cross the threshold the
 * bucket is moved to the locked state. Returns the post-increment state
 * so callers can branch on "this attempt tripped the lock" without a
 * second read.
 */
export async function recordFailure(
  db: AppDatabase,
  key: string,
  policy: LockoutPolicy,
): Promise<LockoutState> {
  const row = await db.select().from(authLockouts).where(eq(authLockouts.key, key)).get();
  const failures = (row?.failures ?? 0) + 1;
  const lockedUntil = failures >= policy.threshold ? Date.now() + policy.windowMs : null;
  if (row) {
    await db.update(authLockouts)
      .set({ failures, lockedUntil, updatedAt: new Date().toISOString() })
      .where(eq(authLockouts.key, key));
  }
  else {
    await db.insert(authLockouts).values({ key, failures, lockedUntil });
  }
  if (lockedUntil !== null)
    return { locked: true, retryAfterSeconds: Math.ceil(policy.windowMs / 1000) };
  return UNLOCKED;
}

/** Drop the row on successful authentication. */
export async function clearFailures(db: AppDatabase, key: string): Promise<void> {
  await db.delete(authLockouts).where(eq(authLockouts.key, key));
}

/** Admin / test helper: drop every lockout row. */
export async function clearAllLockouts(db: AppDatabase): Promise<void> {
  await db.delete(authLockouts);
}

// --- Per-IP rate limiter for auth endpoints ---
// 120/min/IP is comfortably above realistic human throughput (a user
// initiates login at most a handful of times per minute) yet below the
// "many concurrent test callers behind one NAT" floor that would lock
// out a developer or an integration suite. Both /login and /callback
// share this bucket — together they cap the total auth-flow churn from
// any one peer in a sliding minute.
const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX = 120;
const AUTH_RATE_MAX_BUCKETS = 10_000;

interface RateBucket {
  count: number;
  resetAt: number;
}

const authRateBuckets = new Map<string, RateBucket>();

/**
 * True for loopback peers (`127.0.0.0/8`, `::1`, IPv4-mapped loopback).
 */
function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");
}

/**
 * Whether a loopback caller may skip the per-IP auth limiter.
 *
 * The exemption exists so genuine loopback callers — the e2e suite, local
 * integration runs — aren't throttled by the shared per-IP bucket. But under
 * the default `TRUST_PROXY=false` a same-host reverse proxy connects to the app
 * over loopback, so a `127.0.0.1` peer may actually be the proxy fronting every
 * real client (`getClientIp` returns the raw socket peer when `TRUST_PROXY` is
 * off). Exempting it there would silently disable IP throttling for the whole
 * deployment (AUDIT-20260701 → P2 / FIX-049).
 *
 * So loopback is exempt only when it genuinely denotes a trusted local caller:
 *   - `TRUST_PROXY=true` — `getClientIp` then resolves the real end-user IP from
 *     forwarding headers, so a loopback *result* means a direct, on-host caller
 *     rather than a proxied client; OR
 *   - outside production — dev/test ergonomics; no real attacker is present and
 *     120/min/IP is far above any human loopback login rate anyway.
 *
 * In the production + `TRUST_PROXY=false` topology the exemption is withheld, so
 * the same-host-proxy peer is throttled like any other IP.
 */
function isLoopbackRateLimitExempt(ip: string, config: Pick<Config, "NODE_ENV" | "TRUST_PROXY">): boolean {
  return isLoopback(ip) && (config.TRUST_PROXY || config.NODE_ENV !== "production");
}

/** Returns 0 when allowed, else seconds remaining until the bucket resets. */
export function checkAuthRateLimit(ip: string, config: Pick<Config, "NODE_ENV" | "TRUST_PROXY">): number {
  if (isLoopbackRateLimitExempt(ip, config))
    return 0;
  const now = Date.now();
  const bucket = authRateBuckets.get(ip);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= AUTH_RATE_MAX) {
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    }
    bucket.count++;
    return 0;
  }
  if (authRateBuckets.size >= AUTH_RATE_MAX_BUCKETS) {
    const firstKey = authRateBuckets.keys().next().value;
    if (firstKey !== undefined)
      authRateBuckets.delete(firstKey);
  }
  authRateBuckets.set(ip, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
  return 0;
}

// --- Per-username lockout for single-user login ---
// The IP-keyed limiter above caps brute-force from one peer, but an
// attacker rotating proxies / residential IPs can still grind a single
// account. Lock the account after N consecutive failures for a fixed
// window, mirroring the per-user TOTP lockout. State lives in
// `auth_lockouts` so the counter survives process restarts and is shared
// across replicas.
const SINGLE_USER_LOCKOUT_POLICY: LockoutPolicy = {
  threshold: 10,
  windowMs: 15 * 60 * 1000,
};

function singleUserLockoutKey(username: string): string {
  return `single-user:${username.toLowerCase()}`;
}

export async function isSingleUserLocked(
  db: AppDatabase,
  username: string,
): Promise<LockoutState> {
  return isLocked(db, singleUserLockoutKey(username));
}

export async function recordSingleUserFailure(db: AppDatabase, username: string): Promise<LockoutState> {
  return recordFailure(db, singleUserLockoutKey(username), SINGLE_USER_LOCKOUT_POLICY);
}

export async function clearSingleUserFailures(db: AppDatabase, username: string): Promise<void> {
  await clearFailures(db, singleUserLockoutKey(username));
}

/** Test hook — drop every persisted lockout row between specs. */
export async function __resetSingleUserLockoutForTests(db: AppDatabase): Promise<void> {
  await clearAllLockouts(db);
}
