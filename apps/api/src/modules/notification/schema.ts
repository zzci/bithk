import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "success", "failed"] as const;
export type WebhookDeliveryStatus = typeof WEBHOOK_DELIVERY_STATUSES[number];

// Webhook subscriptions (FEAT-060). `events` is a JSON string[] of audit
// action patterns (`*`, `issue.*`, `share.created`). `secret` is the HMAC
// signing key — plaintext at rest like every other stored credential here
// (masked on the wire; token backup exports redact the `secret` field name).
// `created_by` is a soft reference: the admin row may be deleted later and
// the subscription must outlive it.
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret"),
  events: text("events").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // Failed terminal deliveries in a row; reset on the next success. Surfaced
  // in the admin list so a dead endpoint is visible without opening the log.
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastDeliveryAt: text("last_delivery_at"),
  lastDeliveryStatus: text("last_delivery_status", { enum: WEBHOOK_DELIVERY_STATUSES }),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  uniqueIndex("idx_webhooks_name").on(t.name),
  index("idx_webhooks_enabled").on(t.enabled),
]);

// One row per (webhook, event) delivery attempt chain. `id` is a ULID so
// ordering equals creation order; `payload` is the JSON body exactly as
// posted. Cascade-deletes with the webhook. The dispatcher prunes each
// webhook to its latest 200 rows.
export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  // The audit event id that produced the delivery, or `test` for the admin ping.
  eventId: text("event_id").notNull(),
  payload: text("payload").notNull(),
  status: text("status", { enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  responseStatus: integer("response_status"),
  error: text("error"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  finishedAt: text("finished_at"),
}, t => [
  index("idx_webhook_deliveries_webhook_created").on(t.webhookId, t.createdAt),
  index("idx_webhook_deliveries_status").on(t.status),
]);
