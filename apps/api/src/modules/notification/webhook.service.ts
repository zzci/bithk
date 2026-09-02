import type { WebhookDeliveryStatus } from "./schema";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { createHmac } from "node:crypto";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { runWrite } from "@/db";
import { resolveTarget } from "@/modules/cron/actions/http-request/executor";
import { AppError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { webhookDeliveries, webhooks } from "./schema";

export type WebhookRow = typeof webhooks.$inferSelect;

/** Client-facing shape — exposes `hasSecret`, never the signing key. */
export interface WebhookView {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
  readonly hasSecret: boolean;
  readonly consecutiveFailures: number;
  readonly lastDeliveryAt: string | null;
  readonly lastDeliveryStatus: WebhookDeliveryStatus | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeliveryView {
  readonly id: string;
  readonly event: string;
  readonly eventId: string;
  readonly payload: string;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

// ─── Event patterns ────────────────────────────────────────────────────

/** Stored JSON `string[]`; anything malformed reads as "no events". */
export function parseEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  }
  catch {
    return [];
  }
}

/** Trim, drop blanks and duplicates; a `*` anywhere collapses the list to `["*"]`. */
export function normalizeEvents(input: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of input) {
    const p = raw.trim();
    if (p !== "")
      seen.add(p);
  }
  return seen.has("*") ? ["*"] : [...seen];
}

/**
 * Does an audit action match a subscription? `*` matches everything,
 * `prefix.*` matches every action under that dotted namespace, anything
 * else is an exact action name.
 */
export function matchesEvent(patterns: readonly string[], action: string): boolean {
  for (const pattern of patterns) {
    if (pattern === "*")
      return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -1); // keep the trailing dot
      if (action.startsWith(prefix) && action.length > prefix.length)
        return true;
    }
    else if (pattern === action) {
      return true;
    }
  }
  return false;
}

// ─── Signing ───────────────────────────────────────────────────────────

/** `sha256=` + hex HMAC-SHA256 over `${timestamp}.${body}` — the receiver recomputes it. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

// ─── URL policy ────────────────────────────────────────────────────────

/**
 * http(s) only, parseable, and — unless `HTTP_ACTION_ALLOW_PRIVATE` — no
 * loopback / private / link-local destination (the cron `http-request`
 * gate, reused so both admin-supplied URL surfaces share one policy). The
 * dispatcher re-checks per delivery; this front-loads the rejection into
 * the create / update response.
 */
export async function validateWebhookUrl(config: Pick<Config, "HTTP_ACTION_ALLOW_PRIVATE">, url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  }
  catch {
    throw new AppError("Webhook URL is not a valid URL", 400, "INVALID_WEBHOOK_URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new AppError("Webhook URL must use http or https", 400, "INVALID_WEBHOOK_URL");
  try {
    await resolveTarget(config, url);
  }
  catch (err) {
    throw new AppError(`Webhook URL refused: ${err instanceof Error ? err.message : String(err)}`, 400, "INVALID_WEBHOOK_URL");
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

function toView(row: WebhookRow): WebhookView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: parseEvents(row.events),
    enabled: row.enabled,
    hasSecret: row.secret !== null && row.secret !== "",
    consecutiveFailures: row.consecutiveFailures,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryStatus: row.lastDeliveryStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listWebhooks(db: AppDatabase): Promise<readonly WebhookView[]> {
  const rows = await db.select().from(webhooks).orderBy(webhooks.name).all();
  return rows.map(toView);
}

export async function getWebhook(db: AppDatabase, id: string): Promise<WebhookView | undefined> {
  const row = await getWebhookRow(db, id);
  return row ? toView(row) : undefined;
}

/** Full row including the secret — dispatcher / test-send use only. */
export async function getWebhookRow(db: AppDatabase, id: string): Promise<WebhookRow | undefined> {
  return db.select().from(webhooks).where(eq(webhooks.id, id)).get();
}

export async function listEnabledWebhookRows(db: AppDatabase): Promise<readonly WebhookRow[]> {
  return db.select().from(webhooks).where(eq(webhooks.enabled, true)).all();
}

async function assertNameFree(db: AppDatabase, name: string, exceptId?: string): Promise<void> {
  const where = exceptId === undefined
    ? eq(webhooks.name, name)
    : and(eq(webhooks.name, name), ne(webhooks.id, exceptId));
  const clash = await db.select({ id: webhooks.id }).from(webhooks).where(where).get();
  if (clash)
    throw new AppError(`A webhook named "${name}" already exists`, 409, "WEBHOOK_NAME_CONFLICT");
}

export interface CreateWebhookInput {
  readonly name: string;
  readonly url: string;
  readonly secret?: string | undefined;
  readonly events: readonly string[];
  readonly enabled?: boolean | undefined;
  readonly createdBy: string;
}

export async function createWebhook(db: AppDatabase, input: CreateWebhookInput): Promise<WebhookView> {
  const name = input.name.trim();
  await assertNameFree(db, name);
  const id = nanoid();
  const now = new Date().toISOString();
  const secret = input.secret?.trim();
  await db.insert(webhooks).values({
    id,
    name,
    url: input.url.trim(),
    secret: secret || null,
    events: JSON.stringify(normalizeEvents(input.events)),
    enabled: input.enabled ?? true,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await getWebhook(db, id))!;
}

export interface UpdateWebhookInput {
  readonly name?: string | undefined;
  readonly url?: string | undefined;
  /** `undefined` keeps the saved secret, `null` clears it, a string replaces it. */
  readonly secret?: string | null | undefined;
  readonly events?: readonly string[] | undefined;
  readonly enabled?: boolean | undefined;
}

export async function updateWebhook(db: AppDatabase, id: string, patch: UpdateWebhookInput): Promise<WebhookView | undefined> {
  const existing = await getWebhookRow(db, id);
  if (!existing)
    return undefined;
  const set: Partial<typeof webhooks.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    await assertNameFree(db, name, id);
    set.name = name;
  }
  if (patch.url !== undefined)
    set.url = patch.url.trim();
  if (patch.events !== undefined)
    set.events = JSON.stringify(normalizeEvents(patch.events));
  if (patch.enabled !== undefined)
    set.enabled = patch.enabled;
  if (patch.secret !== undefined) {
    const secret = patch.secret?.trim();
    set.secret = secret || null;
  }
  await db.update(webhooks).set(set).where(eq(webhooks.id, id)).run();
  return getWebhook(db, id);
}

/** Hard delete; `webhook_deliveries` cascades. */
export async function deleteWebhook(db: AppDatabase, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(webhooks).where(eq(webhooks.id, id)).run());
  return result.changes > 0;
}

export async function listDeliveries(
  db: AppDatabase,
  webhookId: string,
  page: { readonly page: number; readonly limit: number },
): Promise<{ readonly data: readonly DeliveryView[]; readonly total: number }> {
  const where = eq(webhookDeliveries.webhookId, webhookId);
  const totalRow = await db.select({ value: count() }).from(webhookDeliveries).where(where).get();
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(where)
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(page.limit)
    .offset((page.page - 1) * page.limit)
    .all();
  return { data: rows, total: totalRow?.value ?? 0 };
}
