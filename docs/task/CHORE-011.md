# CHORE-011 - Remove the dead SMTP / Webhook settings tabs and the orphan Vite API entry

- Status: In Progress (investigation; awaiting proposal approval)
- Plan: [PLAN-111](../plan/PLAN-111.md)
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-01

## Goal

The admin Settings page ships an SMTP tab (writes `smtp.*`, including
`smtp.password`) and a Webhooks tab (writes `webhook.endpoints`). Nothing in
the API reads either prefix, so the tabs collect a credential and endpoint
list that no code ever uses. `apps/api/src/dev.ts` is an `@hono/vite-dev-server`
entry; that package is not a dependency and no script references the file.

## Scope

- Delete `-settings-smtp.tsx` / `-settings-webhook.tsx`, their tabs in
  `settings.lazy.tsx`, the `smtp` / `webhook` locale blocks and tab labels in
  both locales, the `settings:tabs.smtp` parity exemption, and the stale
  comment in `shared/lib/api/settings.ts`; reword `page.description`.
- Delete `apps/api/src/dev.ts` and its `bunfig.toml` coverage-ignore entry.

## Verification

- RED: a settings page test asserts the tab list is exactly the seven
  remaining tabs.
- `bun run check` (incl. `check:i18n`) EXIT 0.
