import type Baker from "cronbake";
import type { AppDatabase } from "@/db";
import type { cronJobs } from "@/modules/cron/schema";
import { desc, eq } from "drizzle-orm";
import { cronJobLogs } from "@/modules/cron/schema";
import { getAction } from "./actions";

/** Placeholder echoed back in place of any secret value. */
const REDACTED = "[REDACTED]";

/**
 * Config key names that conventionally carry credentials. Matched
 * case-insensitively at every nesting depth so a Bearer token tucked
 * inside an http-request `headers` object (`{ Authorization: "Bearer …" }`)
 * is masked just like a top-level `token`. Kept in sync with the deny-list
 * the structured logger uses (`shared/lib/logger.ts`) so the two redaction
 * surfaces stay aligned.
 */
const SENSITIVE_KEY_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "api_key",
  "apikey",
  "x-api-key",
]);

const REDACT_MAX_DEPTH = 8;

/**
 * Recursively copy `value`, replacing any object entry whose key is a
 * declared `secret`-typed input (`secretKeys`) or matches the sensitive
 * name deny-list with `[REDACTED]`. Pure — never mutates its input; the
 * source is always a `JSON.parse` result so there are no cycles, Errors,
 * or non-enumerable props to worry about.
 */
function redactSecrets(value: unknown, secretKeys: ReadonlySet<string>, depth = 0): unknown {
  if (depth > REDACT_MAX_DEPTH || value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value))
    return value.map(v => redactSecrets(v, secretKeys, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    out[k] = secretKeys.has(lower) || SENSITIVE_KEY_NAMES.has(lower)
      ? REDACTED
      : redactSecrets(v, secretKeys, depth + 1);
  }
  return out;
}

/** Lowercased keys the action declares as `secret`-typed inputs. */
function secretKeysFor(action: unknown): ReadonlySet<string> {
  if (typeof action !== "string")
    return new Set();
  const inputs = getAction(action)?.spec.inputs ?? [];
  return new Set(inputs.filter(i => i.type === "secret").map(i => i.key.toLowerCase()));
}

export interface LastRun {
  readonly status: string;
  readonly startedAt: string;
  readonly durationMs: number | null;
  readonly result: string | null;
  readonly error: string | null;
}

export interface SerializedCronJob {
  readonly id: string;
  readonly name: string;
  readonly cron: string;
  readonly taskType: string;
  readonly taskConfig: Record<string, unknown>;
  readonly enabled: boolean;
  readonly status: string;
  readonly nextExecution: string | null;
  readonly lastRun: LastRun | null;
  readonly maxConsecutiveFailures: number;
  readonly isDeleted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Fold a `cron_jobs` row + live Baker state + last log row into one DTO. The
 * Baker handle is optional so callers without a running scheduler (tests,
 * the just-deleted path that already removed the job from Baker) still get
 * a coherent payload — `status` falls back to a DB-derived label and
 * `nextExecution` is null.
 */
export async function serializeJob(
  db: AppDatabase,
  baker: Baker | null,
  row: typeof cronJobs.$inferSelect,
): Promise<SerializedCronJob> {
  let status = row.enabled ? "not_loaded" : "disabled";
  let nextExecution: string | null = null;

  if (baker) {
    try {
      status = baker.getStatus(row.name);
      const next = baker.nextExecution(row.name);
      nextExecution = next ? next.toISOString() : null;
    }
    catch {
      // Job not registered in Baker (e.g. just deleted) — keep DB-derived defaults.
    }
  }

  // Secret-typed inputs and sensitively-named fields (e.g. an http-request
  // `headers.Authorization` Bearer token) are stored in `task_config`
  // plaintext but MUST NOT be echoed back to the listing/create responses —
  // the `secret` input type is UI-masking only. Redact before returning.
  // NOTE: at-rest encryption of these fields remains TODO (FIX-AUDIT-005) —
  // it requires a decrypt step in the scheduled-execution path
  // (`cron.service.ts`/`executor.ts`), out of this change's scope.
  let taskConfig: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.taskConfig) as Record<string, unknown>;
    taskConfig = redactSecrets(parsed, secretKeysFor(parsed.action)) as Record<string, unknown>;
  }
  catch {
    // Corrupt config: surface a marker rather than the raw string, which
    // could itself embed a secret substring.
    taskConfig = { _raw: REDACTED };
  }

  const latestLog = await db
    .select({
      status: cronJobLogs.status,
      startedAt: cronJobLogs.startedAt,
      durationMs: cronJobLogs.durationMs,
      result: cronJobLogs.result,
      error: cronJobLogs.error,
    })
    .from(cronJobLogs)
    .where(eq(cronJobLogs.jobId, row.id))
    .orderBy(desc(cronJobLogs.id))
    .limit(1)
    .get();

  const lastRun: LastRun | null = latestLog
    ? {
        status: latestLog.status,
        startedAt: latestLog.startedAt,
        durationMs: latestLog.durationMs,
        result: latestLog.result,
        error: latestLog.error,
      }
    : null;

  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    taskType: row.taskType,
    taskConfig,
    enabled: row.enabled,
    status,
    nextExecution,
    lastRun,
    maxConsecutiveFailures: row.maxConsecutiveFailures,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
