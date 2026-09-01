# FEAT-060 - Webhook subscriptions with signed, retried deliveries

- Status: In Progress (investigation; awaiting proposal approval)
- Plan: [PLAN-112](../plan/PLAN-112.md)
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-01

## Goal

The admin Webhooks tab stores endpoints as ad-hoc `webhook.*` settings rows
that nothing reads. Replace that with a real subscription model: webhooks in
their own tables, audit events fanned out to matching endpoints with an HMAC
signature, bounded retries, and a delivery log the admin can inspect.

## Scope

- Tables `webhooks` (name, url, secret, events pattern list, enabled,
  consecutive failures) and `webhook_deliveries` (event, payload, attempts,
  status, response status, error) with a fresh drizzle migration; backup
  contribution for both.
- Audit emitter (`onAuditEvent`) in the audit module; the notification module
  subscribes at load. Matching: exact action, `prefix.*`, or `*`.
- Dispatcher: in-process queue, one delivery in flight per webhook, three
  attempts with backoff, SSRF guard and timeout reused from the cron
  `http-request` action, 3xx treated as failure (no redirect following),
  `X-Webhook-Signature: sha256=HMAC(secret, timestamp.body)`, prune to the
  latest 200 deliveries per webhook.
- Admin routes under `/admin/webhooks`: list / create / read / update /
  delete / `POST :id/test` / `GET :id/deliveries`; audited.
- Web: Webhooks tab rewritten on the new API (table with enabled state and
  last delivery outcome, create / edit dialog, delete confirm, "Send test",
  deliveries dialog). Legacy `webhook.*` settings rows are left in place.
- Module doc `docs/modules/notification.md`, rows in architecture / api /
  database references, e2e module dir + `MODULE_DIRS` entry.

Out of scope: redelivery of a single past delivery, per-event payload
schemas beyond the audit shape, an event catalogue endpoint.

## Verification

- RED unit: pattern matching; signature bytes against a fixed vector;
  retry/backoff and terminal failure with a fake fetch; private URL rejected
  at create time.
- RED route: CRUD is admin-only; secret is write-only (never echoed).
- e2e: create a webhook pointing at an in-test HTTP receiver, trigger
  `POST :id/test`, assert the receiver got a signed payload and the delivery
  row reads `success`.
- `bun run check` EXIT 0.
