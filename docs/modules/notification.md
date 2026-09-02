# Notification Module

Outbound notifications fed by the audit event stream: SMTP email delivery
(FEAT-059) and webhook subscriptions (FEAT-060, see below). Every mutating
route already records an `audit_events` row through `audit()`; the module
subscribes to that stream (`onAuditEvent`) so no business route knows about
mail or webhooks.

## File layout

```text
apps/api/src/modules/notification/
  mail.service.ts         # SMTP config (settings rows) + sendMail via nodemailer
  mail.queue.ts           # serial in-process queue for background sends
  consumers.ts            # audit event -> MailMessage (share.created, issue.assigned)
  webhook.service.ts      # subscriptions CRUD, event matching, HMAC signing, URL policy
  webhook.dispatcher.ts   # per-webhook delivery lanes, retries, delivery log, pruning
  notification.routes.ts  # POST /admin/smtp/test, /admin/webhooks CRUD + test + deliveries
  notification.backup.ts  # backup contribution for the two webhook tables
  schema.ts               # webhooks, webhook_deliveries
  index.ts                # start/stop hooks, routes
```

## SMTP

Configuration is stored in the settings table (the admin Settings › SMTP tab
writes it through the generic `/settings/:key` CRUD; `smtp.password` is
masked on read by the `.password` suffix rule):

| Key | Meaning |
|---|---|
| `smtp.enabled` | `"true"` turns delivery on; anything else makes every send a silent no-op. |
| `smtp.host`, `smtp.port` | Relay address. Port defaults to 587 when unset or malformed. |
| `smtp.secure` | `"true"` = implicit TLS (typically 465); otherwise STARTTLS when the relay offers it. |
| `smtp.username`, `smtp.password` | Optional AUTH credentials. |
| `smtp.from_address`, `smtp.from_name` | Envelope / header sender. `from_address` is required. |

`sendMail(db, logger, { to, subject, text })` reads the rows on every call
(an admin change applies without a restart), returns `{ status: "skipped" }`
while SMTP is disabled or incomplete, and rejects on a transport failure.
Each socket phase is bounded (15 s; 10 s for the interactive test send).

### Notification emails

`consumers.ts` turns two audit actions into one plain-text, bilingual message
each, queued through `mail.queue.ts` so the triggering request never waits
on the relay. Recipients must be real (non-virtual), active users with an
email address; self-triggered events are skipped.

| Audit action | Recipient | Link |
|---|---|---|
| `share.created` (`shareType = direct`) | `detail.sharedWithUserId` | `/documents/:shortId` for documents, `/drive` otherwise |
| `issue.assigned` | the user behind `detail.to` (a `project_members.id`) | `/projects/:projectShortId/issues/:issueShortId` |

Links are built from `APP_URL` + `BASE_PATH`; with `APP_URL` unset they are
path-only. Delivery failures are logged at `warn` and dropped — the audit row
is the record, the email is best-effort. Mail queued at shutdown is lost after
the in-flight send drains.

## Webhooks

A webhook is a subscription: a name (unique), an http(s) URL, an optional
signing secret, a list of audit-action patterns and an `enabled` flag. Every
successfully persisted audit event is matched against every enabled
subscription; each match becomes one `webhook_deliveries` row and one
background POST.

**Patterns.** `*` matches everything, `prefix.*` matches every action under
that dotted namespace (`issue.*` → `issue.assigned`, not `issues.create`),
anything else is an exact action name. A `*` anywhere in the list collapses
it to `["*"]`.

**Payload** (`Content-Type: application/json`):

```json
{
  "id": "<audit event id>",
  "event": "issue.assigned",
  "occurredAt": "2026-09-01T00:00:00.000Z",
  "actor": { "id": "u1", "name": "Alice" },
  "resource": { "type": "issue", "id": "iss1", "name": "Fix winch" },
  "detail": { "from": null, "to": "m1" },
  "result": "success"
}
```

**Headers.** `X-Webhook-Event`, `X-Webhook-Delivery` (the delivery row id),
`X-Webhook-Timestamp` (unix seconds), `User-Agent: bithk-webhook/1`, and —
when the subscription has a secret — `X-Webhook-Signature:
sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`. Receivers should
recompute the HMAC over the raw body and reject stale timestamps.

**Delivery.** Deliveries to one webhook run serially in order; different
webhooks run independently, so a stalled endpoint never delays the others.
Up to three attempts (waits of 1 s and 10 s), each bounded by
`HTTP_ACTION_TIMEOUT_SECONDS`; only a 2xx counts, a 3xx is a failure and is
never followed. The URL passes the cron `http-request` SSRF gate on create /
update and again per attempt (`HTTP_ACTION_ALLOW_PRIVATE` opens loopback /
private ranges). A terminal failure bumps the webhook's
`consecutive_failures` (reset on the next success) and the list shows the
last outcome. Each webhook keeps its latest 200 deliveries. The queue is
process-local: work pending at shutdown is stopped after the in-flight
attempt.

## Database

### `webhooks`

| Column | Notes |
|---|---|
| `id` | **nanoid**. |
| `name` | Required; unique via `idx_webhooks_name`. |
| `url` | http(s) endpoint. |
| `secret` | HMAC signing key, nullable; plaintext at rest, never returned (`hasSecret` on the wire). |
| `events` | JSON `string[]` of patterns. |
| `enabled` | Integer boolean. |
| `consecutive_failures`, `last_delivery_at`, `last_delivery_status` | Rolling delivery health. |
| `created_by` | Soft reference to the admin's user id. |

### `webhook_deliveries`

| Column | Notes |
|---|---|
| `id` | **ULID** (also the `X-Webhook-Delivery` header). |
| `webhook_id` | FK → `webhooks.id ON DELETE CASCADE`. |
| `event`, `event_id` | Audit action + audit event id (`test-…` for pings). |
| `payload` | The JSON body exactly as posted. |
| `status` | `pending` / `success` / `failed`. |
| `attempts`, `response_status`, `error`, `created_at`, `finished_at` | Attempt-chain outcome. |

## Routes

Mounted under `protectedRoutes`; `/admin/*` is ungated by module visibility
and scoped to the `account` PAT module. All routes are admin-only.

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/smtp/test` | Mails the calling admin. `409 SMTP_DISABLED` / `SMTP_UNCONFIGURED`, `400 NO_EMAIL`, `502 SMTP_SEND_FAILED` (generic message; the transport error goes to the log). |
| GET | `/api/admin/webhooks` | List subscriptions (`hasSecret`, never the secret). |
| POST | `/api/admin/webhooks` | Create `{ name, url, secret?, events, enabled? }`. `400 INVALID_WEBHOOK_URL`, `409 WEBHOOK_NAME_CONFLICT`. |
| GET | `/api/admin/webhooks/:id` | One subscription. |
| PATCH | `/api/admin/webhooks/:id` | Partial update; `secret: null` clears the key, omitted keeps it. |
| DELETE | `/api/admin/webhooks/:id` | Delete with its delivery log. |
| POST | `/api/admin/webhooks/:id/test` | Queue a `webhook.test` ping regardless of patterns → `202 { deliveryId }`. |
| GET | `/api/admin/webhooks/:id/deliveries` | Paginated delivery log, newest first (`page`, `limit` ≤ 100). |

## Auditing

| Action | Emitted by |
|---|---|
| `smtp.test` | `POST /api/admin/smtp/test` — `success` with `{ to, messageId }`, `failure` with `{ to }`. |
| `webhook.created` / `webhook.updated` / `webhook.deleted` | The webhook CRUD routes (the secret value never appears in `detail`). |
| `webhook.tested` | `POST /api/admin/webhooks/:id/test`. |

Background notification sends and webhook deliveries emit no audit events of
their own (they would feed themselves); outcomes live in `webhook_deliveries`
and the log.

## Backup

`notificationBackupContribution` exports `webhooks` and `webhook_deliveries`
under the module name `notification`; subscriptions list first so the
delivery FK resolves on import. Token exports redact `secret`.

## End-to-end coverage

- `tests/e2e/modules/notification/smtp.test.ts`: the test send answers
  `409 SMTP_DISABLED` on the unconfigured shared API, `403` for non-admins,
  `401` anonymously. The relay round-trip is proven by
  `mail.service.test.ts` / `mail.queue.test.ts` / `notification.routes.test.ts`
  against an in-process `smtp-server`.
- `tests/e2e/modules/notification/webhooks.test.ts`: create → test ping
  delivered to a receiver inside the test process (signature verified) →
  delivery log → update → delete; URL refusal and the permission matrix.

## Out of scope

- Per-user opt-out, HTML templates, digests, HR events (HR routes emit no
  audit events yet).
- Re-delivering a single past delivery, per-event payload schemas beyond the
  audit shape, an event-name catalogue endpoint.
- HTTP mail providers (Resend, SendGrid, …) — a second transport behind
  `sendMail` when needed.
