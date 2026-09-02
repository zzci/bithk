import type { WebhookRow } from "./webhook.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { AuditEvent } from "@/modules/audit/audit.service";
import type { Logger } from "@/shared/lib/logger";
import { desc, eq, notInArray, sql } from "drizzle-orm";
import { onAuditEvent } from "@/modules/audit/audit.service";
import { resolveTarget } from "@/modules/cron/actions/http-request/executor";
import { NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { webhookDeliveries, webhooks } from "./schema";
import { getWebhookRow, listEnabledWebhookRows, matchesEvent, parseEvents, signPayload } from "./webhook.service";

/**
 * Webhook fan-out (FEAT-060). Audit events are matched against every enabled
 * subscription; each match becomes a `webhook_deliveries` row and a
 * background POST. Deliveries to one webhook run serially (in order, one in
 * flight); different webhooks run independently, so a stalled endpoint
 * never delays the others. Three attempts with backoff, then the row is
 * `failed` and the webhook's consecutive-failure counter grows. The request
 * never waits on any of this — the audit row is the record.
 */
export interface WebhookDispatcherDeps {
  readonly db: AppDatabase;
  readonly logger: Logger;
  readonly config: Pick<Config, "HTTP_ACTION_ALLOW_PRIVATE" | "HTTP_ACTION_TIMEOUT_SECONDS">;
}

export interface WebhookPayload {
  readonly id: string;
  readonly event: string;
  readonly occurredAt: string;
  readonly actor: { readonly id: string; readonly name: string };
  readonly resource: { readonly type: string; readonly id: string; readonly name: string };
  readonly detail: Record<string, unknown> | null;
  readonly result: "success" | "failure";
}

export const MAX_DELIVERY_ATTEMPTS = 3;
/** Waits before attempt 2 and attempt 3. */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 10_000];
const DELIVERIES_KEPT_PER_WEBHOOK = 200;
const USER_AGENT = "bithk-webhook/1";

let retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS;

export function buildWebhookPayload(event: AuditEvent): WebhookPayload {
  return {
    id: event.id,
    event: event.action,
    occurredAt: event.createdAt,
    actor: { id: event.actorId, name: event.actorName },
    resource: { type: event.resourceType, id: event.resourceId, name: event.resourceName },
    detail: event.detail ?? null,
    result: event.result,
  };
}

// ─── Lanes ─────────────────────────────────────────────────────────────

interface Job {
  readonly deps: WebhookDispatcherDeps;
  readonly deliveryId: string;
  readonly webhookId: string;
}

const lanes = new Map<string, Promise<void>>();
let active = 0;
let stopping = false;
const idleWaiters: (() => void)[] = [];

function settleIdle(): void {
  if (active === 0) {
    for (const resolve of idleWaiters.splice(0))
      resolve();
  }
}

function schedule(job: Job): void {
  const prev = lanes.get(job.webhookId) ?? Promise.resolve();
  active++;
  const next: Promise<void> = prev
    .then(() => runDelivery(job))
    .catch((err: unknown) => {
      job.deps.logger.error({ err, deliveryId: job.deliveryId }, "webhook delivery crashed");
    })
    .finally(() => {
      active--;
      if (lanes.get(job.webhookId) === next)
        lanes.delete(job.webhookId);
      settleIdle();
    });
  lanes.set(job.webhookId, next);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0)
    return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

// ─── One delivery (attempt chain) ──────────────────────────────────────

interface AttemptOutcome {
  readonly ok: boolean;
  readonly status: number | null;
  readonly error: string | null;
  /** A policy refusal is terminal — retrying cannot change it. */
  readonly terminal: boolean;
}

async function attempt(job: Job, hook: WebhookRow, deliveryId: string, event: string, body: string): Promise<AttemptOutcome> {
  let target;
  try {
    target = await resolveTarget(job.deps.config, hook.url);
  }
  catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err), terminal: true };
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-Webhook-Event": event,
    "X-Webhook-Delivery": deliveryId,
    "X-Webhook-Timestamp": timestamp,
  });
  if (hook.secret)
    headers.set("X-Webhook-Signature", signPayload(hook.secret, timestamp, body));
  const init: RequestInit & { tls?: { serverName: string } } = {
    method: "POST",
    headers,
    body,
    // A 3xx is a failure, never followed: a vetted URL must not bounce the
    // signed payload to a host the gate never saw.
    redirect: "manual",
    signal: AbortSignal.timeout(job.deps.config.HTTP_ACTION_TIMEOUT_SECONDS * 1000),
  };
  if (target.pinned) {
    headers.set("Host", target.host);
    if (target.serverName)
      init.tls = { serverName: target.serverName };
  }
  try {
    const res = await fetch(target.requestUrl, init);
    await res.body?.cancel().catch(() => {});
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, error: ok ? null : `HTTP ${res.status}`, terminal: false };
  }
  catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err), terminal: false };
  }
}

async function runDelivery(job: Job): Promise<void> {
  const { db, logger } = job.deps;
  const delivery = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, job.deliveryId)).get();
  const hook = await getWebhookRow(db, job.webhookId);
  if (!delivery || !hook)
    return; // deleted while queued

  let outcome: AttemptOutcome = { ok: false, status: null, error: "not attempted", terminal: false };
  let attempts = 0;
  for (let n = 1; n <= MAX_DELIVERY_ATTEMPTS; n++) {
    if (stopping)
      break;
    attempts = n;
    outcome = await attempt(job, hook, delivery.id, delivery.event, delivery.payload);
    if (outcome.ok || outcome.terminal)
      break;
    if (n < MAX_DELIVERY_ATTEMPTS)
      await sleep(retryDelaysMs[n - 1] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 0);
  }

  const finishedAt = new Date().toISOString();
  const status = outcome.ok ? "success" : "failed";
  await db.update(webhookDeliveries)
    .set({ status, attempts, responseStatus: outcome.status, error: outcome.error, finishedAt })
    .where(eq(webhookDeliveries.id, delivery.id))
    .run();
  await db.update(webhooks)
    .set({
      lastDeliveryAt: finishedAt,
      lastDeliveryStatus: status,
      consecutiveFailures: outcome.ok ? 0 : sql`${webhooks.consecutiveFailures} + 1`,
    })
    .where(eq(webhooks.id, hook.id))
    .run();
  if (outcome.ok)
    logger.debug({ webhook: hook.name, event: delivery.event, attempts }, "webhook delivered");
  else
    logger.warn({ webhook: hook.name, event: delivery.event, attempts, status: outcome.status, error: outcome.error }, "webhook delivery failed");
  await pruneDeliveries(db, hook.id);
}

async function pruneDeliveries(db: AppDatabase, webhookId: string): Promise<void> {
  const keep = db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(DELIVERIES_KEPT_PER_WEBHOOK);
  await db.delete(webhookDeliveries)
    .where(sql`${webhookDeliveries.webhookId} = ${webhookId} AND ${notInArray(webhookDeliveries.id, keep)}`)
    .run();
}

// ─── Enqueue ───────────────────────────────────────────────────────────

async function insertDelivery(deps: WebhookDispatcherDeps, hook: WebhookRow, event: string, eventId: string, payload: WebhookPayload): Promise<string> {
  const id = ulid();
  await deps.db.insert(webhookDeliveries).values({
    id,
    webhookId: hook.id,
    event,
    eventId,
    payload: JSON.stringify(payload),
    status: "pending",
    createdAt: new Date().toISOString(),
  }).run();
  schedule({ deps, deliveryId: id, webhookId: hook.id });
  return id;
}

/** Fan an audit event out to every enabled matching webhook; returns the rows created. */
export async function enqueueEvent(deps: WebhookDispatcherDeps, event: AuditEvent): Promise<number> {
  const hooks = await listEnabledWebhookRows(deps.db);
  if (hooks.length === 0)
    return 0;
  const payload = buildWebhookPayload(event);
  let created = 0;
  for (const hook of hooks) {
    if (!matchesEvent(parseEvents(hook.events), event.action))
      continue;
    await insertDelivery(deps, hook, event.action, event.id, payload);
    created++;
  }
  return created;
}

/** Admin ping: a `webhook.test` delivery regardless of the subscription's patterns. */
export async function enqueueTest(deps: WebhookDispatcherDeps, webhookId: string, actor: { readonly id: string; readonly name: string }): Promise<string> {
  const hook = await getWebhookRow(deps.db, webhookId);
  if (!hook)
    throw new NotFoundError("Webhook", webhookId);
  const eventId = `test-${ulid()}`;
  const payload: WebhookPayload = {
    id: eventId,
    event: "webhook.test",
    occurredAt: new Date().toISOString(),
    actor,
    resource: { type: "webhook", id: hook.id, name: hook.name },
    detail: { message: "This is a test delivery." },
    result: "success",
  };
  return insertDelivery(deps, hook, "webhook.test", eventId, payload);
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

let unsubscribe: (() => void) | null = null;

/** Subscribe to the audit stream; idempotent per process. */
export function startWebhookDispatcher(deps: WebhookDispatcherDeps): void {
  unsubscribe?.();
  stopping = false;
  unsubscribe = onAuditEvent(async (event, ctx) => {
    await enqueueEvent({ db: ctx.db, logger: ctx.logger, config: deps.config }, event);
  });
}

/** Unsubscribe, stop retry loops, and wait (briefly) for in-flight attempts. */
export async function stopWebhookDispatcher(): Promise<void> {
  unsubscribe?.();
  unsubscribe = null;
  stopping = true;
  await Promise.race([__webhookDispatcherIdle(), sleep(5_000)]);
}

/** Test hook: resolves once no delivery is queued or in flight. */
export function __webhookDispatcherIdle(): Promise<void> {
  if (active === 0)
    return Promise.resolve();
  return new Promise(resolve => idleWaiters.push(resolve));
}

export function __setWebhookRetryDelaysForTests(delays: readonly number[]): void {
  retryDelaysMs = delays;
}

export function __resetWebhookDispatcherForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  lanes.clear();
  active = 0;
  stopping = false;
  idleWaiters.length = 0;
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS;
}
