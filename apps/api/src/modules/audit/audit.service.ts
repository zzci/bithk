import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { auditEvents } from "@/modules/audit/schema";
import { ulid } from "@/shared/lib/id";

// Escape SQLite LIKE wildcards (`%`, `_`) and the backslash escape char in a
// user-supplied prefix so the `action=foo.*` filter matches literally; the
// LIKE must carry an explicit `ESCAPE '\'` clause.
const LIKE_SPECIAL_RE = /[\\%_]/g;

function escapeLike(v: string): string {
  return v.replace(LIKE_SPECIAL_RE, "\\$&");
}

export interface AuditParams {
  readonly actorId: string;
  readonly actorName: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly detail?: Record<string, unknown> | undefined;
  readonly ip: string;
  readonly userAgent: string;
  readonly result: "success" | "failure";
}

/**
 * A persisted audit row as handed to `onAuditEvent` listeners: the request
 * params plus the id and timestamp the insert produced.
 */
export interface AuditEvent extends AuditParams {
  readonly id: string;
  readonly createdAt: string;
}

export interface AuditListenerContext {
  readonly db: AppDatabase;
  readonly logger: Logger;
}

export type AuditListener = (event: AuditEvent, ctx: AuditListenerContext) => void | Promise<void>;

const listeners = new Set<AuditListener>();

/**
 * Subscribe to every successfully persisted audit event (FEAT-059/060).
 * `audit()` is the one choke point every mutating route passes through, so
 * it doubles as the in-process event stream for webhooks and notification
 * emails without any route knowing about either. Listeners run AFTER the
 * insert committed, are isolated from each other, and can never fail the
 * audited request — a throw or rejection is logged at `warn` and dropped.
 * Returns the unsubscribe function.
 */
export function onAuditEvent(listener: AuditListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetAuditListenersForTests(): void {
  listeners.clear();
}

function emitAuditEvent(event: AuditEvent, ctx: AuditListenerContext): void {
  for (const listener of listeners) {
    try {
      const result = listener(event, ctx);
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          ctx.logger.warn({ err, action: event.action }, "audit listener rejected");
        });
      }
    }
    catch (err) {
      ctx.logger.warn({ err, action: event.action }, "audit listener threw");
    }
  }
}

export interface AuditOptions {
  /**
   * Marks a high-sensitivity action (e.g. a destructive restore or a
   * data-exfiltrating export). When the audit write fails for such an
   * action we log at `error` and re-throw, so the action cannot quietly
   * complete with no trail. Routine events leave this `false` (the
   * default) and stay best-effort: the failure is logged at `warn` and
   * swallowed so a flaky audit write never breaks an ordinary request.
   */
  readonly critical?: boolean;
}

/**
 * Persist a single audit event. The `logger` is used only on the
 * failure path (DB insert raised); production callers thread it
 * through from `c.get("logger")` so the failure entry inherits the
 * pino redaction config. Replaces the prior module-level
 * `setAuditLogger` singleton, which forced every test to reset shared
 * state and silently swapped the logger out under DEK rotation.
 *
 * Pass `{ critical: true }` for genuinely sensitive actions so an
 * audit-write failure surfaces (throws) instead of being swallowed.
 */
export async function audit(
  db: AppDatabase,
  logger: Logger,
  params: AuditParams,
  options: AuditOptions = {},
): Promise<string | undefined> {
  try {
    const id = ulid();
    const createdAt = new Date().toISOString();
    await db.insert(auditEvents).values({
      id,
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      resourceName: params.resourceName,
      detail: params.detail ? JSON.stringify(params.detail) : null,
      ip: params.ip,
      userAgent: params.userAgent,
      result: params.result,
      createdAt,
    }).run();
    if (listeners.size > 0)
      emitAuditEvent({ ...params, id, createdAt }, { db, logger });
    return id;
  }
  catch (err) {
    if (options.critical) {
      logger.error({ err, action: params.action }, "Failed to write audit event for a sensitive action");
      throw err;
    }
    logger.warn({ err, action: params.action }, "Failed to write audit event");
    return undefined;
  }
}

interface ListAuditParams {
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly result?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export async function listAuditEvents(db: AppDatabase, params: ListAuditParams = {}) {
  const { actorId, action, resourceType, resourceId, result, from, to, page = 1, limit = 50 } = params;

  const conditions = [];
  if (actorId) {
    conditions.push(eq(auditEvents.actorId, actorId));
  }
  if (action) {
    if (action.endsWith(".*")) {
      const prefix = escapeLike(action.slice(0, -1));
      conditions.push(sql`${auditEvents.action} LIKE ${`${prefix}%`} ESCAPE '\\'`);
    }
    else {
      conditions.push(eq(auditEvents.action, action));
    }
  }
  if (resourceType) {
    conditions.push(eq(auditEvents.resourceType, resourceType));
  }
  if (resourceId) {
    conditions.push(eq(auditEvents.resourceId, resourceId));
  }
  if (result) {
    conditions.push(eq(auditEvents.result, result as "success" | "failure"));
  }
  if (from) {
    conditions.push(gte(auditEvents.createdAt, from));
  }
  if (to) {
    conditions.push(lte(auditEvents.createdAt, to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = await db.select({ value: count() }).from(auditEvents).where(where).get();
  const total = totalRow?.value ?? 0;

  const data = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  return { data, total };
}

export async function getAuditEventById(db: AppDatabase, id: string) {
  return await db.select().from(auditEvents).where(eq(auditEvents.id, id)).get();
}
