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
  notification.routes.ts  # POST /admin/smtp/test
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

## Routes

Mounted under `protectedRoutes`; `/admin/*` is ungated by module visibility
and scoped to the `account` PAT module.

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/api/admin/smtp/test` | Admin | Mails the calling admin. `409 SMTP_DISABLED` / `SMTP_UNCONFIGURED`, `400 NO_EMAIL`, `502 SMTP_SEND_FAILED` (generic message; the transport error goes to the log). |

## Auditing

| Action | Emitted by |
|---|---|
| `smtp.test` | `POST /api/admin/smtp/test` — `success` with `{ to, messageId }`, `failure` with `{ to }`. |

Background notification sends emit no audit events of their own.

## Backup

No tables yet (FEAT-060 adds `webhooks` / `webhook_deliveries`).

## End-to-end coverage

`tests/e2e/modules/notification/smtp.test.ts`: the test send answers
`409 SMTP_DISABLED` on the unconfigured shared API, `403` for non-admins,
`401` anonymously. The relay round-trip is proven by
`mail.service.test.ts` / `mail.queue.test.ts` / `notification.routes.test.ts`
against an in-process `smtp-server`.

## Out of scope

- Per-user opt-out, HTML templates, digests, HR events (HR routes emit no
  audit events yet).
- HTTP mail providers (Resend, SendGrid, …) — a second transport behind
  `sendMail` when needed.
