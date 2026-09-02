# FEAT-059 - SMTP email delivery: transport, test send, and notification emails

- Status: Completed (2026-09-01)
- Plan: [PLAN-112](../plan/PLAN-112.md)
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-01

## Goal

The admin Settings SMTP tab already collects `smtp.enabled / host / port /
username / password / from_address / from_name`, but nothing sends mail. Give
those settings a backend: a mail service that reads them at send time, an
admin "send test email" action, and the first two notification emails driven
by existing audit events (direct share received, issue assigned).

## Scope

- API `notification` module (shared with FEAT-060): `mail.service.ts`
  (nodemailer transport built from the settings, `smtp.secure` added for
  implicit TLS, disabled/unconfigured short-circuit), `POST /admin/smtp/test`
  (admin-only, mails the caller's own address, audited `smtp.test`).
- Notification consumers subscribed to the new audit emitter:
  `share.created` with `shareType=direct` mails the recipient (the share
  route adds `sharedWithUserId` to its audit detail); `issue.assigned` mails
  the internal assignee. Plain-text bilingual templates with a deep link
  built from `APP_URL`; sends run off the request path and never fail the
  triggering request.
- Web: SMTP tab gains the `smtp.secure` switch and a "Send test email" button
  (toast on success / error).
- Dependencies: `nodemailer` + `@types/nodemailer` (latest at npm, verified
  at implementation); `smtp-server` as a dev dependency for the in-process
  round-trip test.

Out of scope: per-user opt-out, HTML templates, digest emails, HR events
(HR routes emit no audit events yet).

## Verification

- RED unit: `mail.service.test.ts` delivers to an in-process `smtp-server`
  and asserts sender / recipient / subject; disabled config is a no-op.
- RED route: `/admin/smtp/test` is admin-only, 409 when SMTP is disabled,
  502 with a safe message when the transport fails.
- RED consumer: a `share.created` direct event yields one queued mail to the
  recipient; a public-link share yields none.
- e2e: the test-send route against the live API.
- `bun run check` EXIT 0.

## Notes

- 2026-09-01: shipped as the `notification` module — `mail.service.ts`
  (nodemailer 9.1.1, settings-backed, `smtp.secure`), `mail.queue.ts`,
  `consumers.ts` on the new `onAuditEvent` stream (`share.created` direct,
  `issue.assigned`), `POST /admin/smtp/test`; SMTP tab gains the TLS switch
  and the test-send button. Unit round-trips run against an in-process
  `smtp-server` 3.19.6 (dev dependency). e2e `notification/smtp.test.ts`
  covers the gates. `bun run check` EXIT 0.
