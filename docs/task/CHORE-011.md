# CHORE-011 - Remove the orphan Vite API entry

- Status: In Progress (investigation; awaiting proposal approval)
- Plan: [PLAN-111](../plan/PLAN-111.md)
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-01

## Goal

`apps/api/src/dev.ts` is an `@hono/vite-dev-server` entry; that package is not
a dependency and no script references the file. Delete it.

Re-scoped on 2026-09-01: the audit also flagged the admin SMTP and Webhook
settings tabs as dead UI (no backend reads `smtp.*` or `webhook.*`). The user
decided to build those features instead of removing the tabs; that work is
[FEAT-059](FEAT-059.md) and [FEAT-060](FEAT-060.md) under
[PLAN-112](../plan/PLAN-112.md).

## Scope

- Delete `apps/api/src/dev.ts` and its `bunfig.toml` coverage-ignore entry.

## Verification

- `grep -rn "dev.ts" apps/api` finds no remaining reference.
- `bun run check` EXIT 0.
