# PLAN-112 - SMTP email delivery and webhook subscriptions

- Status: Implementing
- Approved: 2026-09-01
- Task: [FEAT-059](../task/FEAT-059.md), [FEAT-060](../task/FEAT-060.md)
- Campaign: local
- Created: 2026-09-01

## Context

- The 2026-09-01 audit found the admin Settings SMTP and Webhook tabs
  (`apps/web/src/app/routes/_app/admin/-settings-smtp.tsx`,
  `-settings-webhook.tsx`) writing `smtp.*` / `webhook.*` settings rows that
  no API code reads. The user chose to complete the features rather than
  delete the tabs (PLAN-111 annotation).
- What the tabs already imply: SMTP host / port / username / password
  (masked by the `.password` suffix rule) / from address / from name plus an
  `smtp.enabled` switch; webhooks with name, URL, optional signing secret and
  a comma-separated event list or `*`
  (`locales/en/settings.json` "eventsHint").
- Event source: every mutating route already calls `audit()`
  (`modules/audit/audit.service.ts`) with a stable `action` vocabulary
  (`issue.assigned`, `share.created`, `drive.file.uploaded`, ... about 90
  names). The service has no hook; adding an in-process emitter after the
  successful insert gives webhooks and emails one event stream without
  touching any route.
- Reusable pieces: the cron `http-request` action exports `resolveTarget`
  (SSRF gate + DNS pinning) and honours `HTTP_ACTION_ALLOW_PRIVATE` /
  `HTTP_ACTION_TIMEOUT_SECONDS`; `retention.ts` shows the unref'd background
  worker + stop hook pattern; `storage-config.ts` shows settings-backed
  runtime config read from the DB; `cron_job_logs` is the per-run log shape.
- The legacy tree (`backup/bithk.bks/.../mod-notification`) once had
  `webhooks` + `webhook_logs` tables with the same fields (name, url, secret,
  events, isActive; eventType, payload, responseStatus, attempts, status),
  confirming the intended model.
- Email consumers with data already in the audit stream: `share.created`
  (needs `sharedWithUserId` added to its detail) and `issue.assigned`
  (`detail.to` is a `project_members.id`; internal members resolve to a
  user with an email). HR emits no audit events, so HR mail is out of scope.
- Dependencies verified at npm on 2026-09-01: `nodemailer` 9.1.1 (no bundled
  types), `@types/nodemailer` 8.0.1. `smtp-server` (same author) will be
  verified when added as a dev dependency for the round-trip test.
- New-module wiring per `docs/develop/module/playbook.md`: schema re-export,
  mount in `routes/protected.ts` (prefix `/admin/*` is already ungated and
  scoped to the `account` PAT module, same precedent as `/admin/storage`),
  backup contribution, i18n keys (existing `settings` namespace), unit + e2e
  tests, module doc, migration via `bun run --filter @app/api db:generate`.

## Approach

One `notification` module, two lanes, SMTP first (smaller, no schema):

### FEAT-059 — SMTP

1. `notification/mail.service.ts`: `readSmtpConfig(db)` (settings keys as
   above plus `smtp.secure`), `sendMail(db, logger, { to, subject, text })`
   creating a nodemailer transport per call (config is tiny; no cache to
   invalidate). Disabled or incomplete config returns `{ skipped }`.
2. `POST /admin/smtp/test` (admin): sends to the caller's email; 409 when
   disabled, 502 with a generic message on transport failure (the real error
   goes to the logger); audit `smtp.test`.
3. `notification/consumers.ts`: subscribes to the audit emitter; for
   `share.created` (direct) and `issue.assigned` builds a bilingual plain-text
   message with an `APP_URL` deep link and hands it to a small in-process mail
   queue (serial, never throws into the request).
4. Web: `smtp.secure` switch and "Send test email" button on the SMTP tab;
   `shared/lib/api/smtp.ts` + test.

### FEAT-060 — Webhooks

1. `notification/schema.ts`: `webhooks`, `webhook_deliveries` (shapes in the
   task file); migration `0001_*`.
2. `audit.service.ts`: `onAuditEvent(listener): () => void`; `audit()` emits
   `{ id, ...params }` after a successful insert, listeners wrapped in
   try/catch so a subscriber can never fail the audited request.
3. `notification/webhook.service.ts`: CRUD, `matchesEvent(patterns, action)`,
   `signPayload(secret, timestamp, body)`; `webhook.dispatcher.ts`: queue +
   worker (start/stop wired in `app.ts` / `index.ts` like the sweeps),
   attempts 1s / 10s / 60s, `resolveTarget` + `AbortSignal.timeout`,
   `redirect: "manual"`, delivery rows updated per attempt, prune to 200 per
   webhook, `consecutiveFailures` on the webhook row.
4. Routes under `/admin/webhooks` (admin-only; `secret` write-only; URL
   validated with `validateUrlScheme` + `resolveTarget` at create/update).
5. Web: Webhooks tab on the new API; `shared/lib/api/webhooks.ts` + tests;
   settings i18n keys extended in both locales.
6. Docs: `docs/modules/notification.md`; one row each in `architecture.md`,
   `reference/api.md`, `reference/database.md`; regenerate api-routes /
   spec / types; changelog `Added`.

### Order and delivery

After PLAN-111 lands. One commit per task, each RED -> GREEN -> IMPROVE with
`bun run check`. Fast-forward local `main`; no push.

## Risks

- nodemailer on Bun: widely used, but the round-trip unit test is the proof;
  if Bun's `tls`/`net` surface trips it, fall back to a minimal SMTP client
  (raise in the task notes before diverging).
- Outbound requests from the server: webhook targets are admin-supplied URLs;
  the cron SSRF gate and timeout are reused, so the exposure equals the
  existing `http-request` action. Private targets need
  `HTTP_ACTION_ALLOW_PRIVATE=true`, as today.
- Secrets at rest: `smtp.password` (settings) and `webhooks.secret` are
  plaintext in SQLite like every other stored credential here (documented in
  architecture.md); token backup exports redact both (`password` / `secret`
  are in `SECRET_FIELD_NAMES`).
- Event volume: the emitter fires on every audited action; matching is an
  in-memory string test and non-matching events cost nothing. The queue is
  process-local, so deliveries pending at shutdown are lost after the drain
  window (logged; deliveries table shows `pending`).
- Migration: the first post-baseline migration; must be generated, never
  hand-applied to 0000.

## Scope

- API: new `modules/notification/` (schema, mail.service, webhook.service,
  webhook.dispatcher, consumers, routes, backup, index, tests),
  `modules/audit/audit.service.ts` (+ test), `modules/share/share.routes.ts`
  (one detail field), `db/schema.ts`, `routes/protected.ts`, `app.ts` /
  `index.ts` (start/stop), `drizzle/0001_*`, `package.json` deps.
- Web: two tab rewrites, two api-layer files, locale keys, tests.
- e2e: `tests/e2e/modules/notification/*.test.ts`, `run.ts` MODULE_DIRS.
- Docs: module doc + reference rows + changelog.

## Alternatives

- **Keep webhooks in the settings table** (as the tab does today) and only
  add a dispatcher: no migration, but no delivery log, no unique names, and
  every read parses JSON out of key-value rows. Rejected.
- **Cron action instead of an event stream** (a scheduled "send digest" job
  per `docs/develop/module/cron-actions.md`): fine for digests, wrong for
  per-event webhooks; can be added later on top of the same mail service.
- **HTTP mail providers (Resend / SendGrid) instead of SMTP**: the tab is
  SMTP-shaped and internal deployments usually have an SMTP relay; a provider
  transport can be added behind the same `sendMail` later.

## Annotations

- 2026-09-01 (user): `proceed` as proposed.

## Status Notes

- 2026-09-01: FEAT-059 landed (see the task notes). nodemailer ran on Bun
  without any workaround — the in-process `smtp-server` round-trip passed on
  the first run, so the fallback client in Risks is not needed. FEAT-060 next.
