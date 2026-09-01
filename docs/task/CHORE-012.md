# CHORE-012 - Audit P3 follow-ups: docs drift, drive project fan-out cap, web coverage floor

- Status: In Progress (investigation; awaiting proposal approval)
- Plan: [PLAN-111](../plan/PLAN-111.md)
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-01

## Goal

Three low-priority items from the 2026-09-01 audit that are cheap to close:

- `docs/develop/deployment.md`, `forking.md`, `operations.md` and the
  `apps/api/src/config/sentinels.ts` comment describe an `examples/compose/`
  stack that does not exist; the real test stack is the root
  `docker-compose.yml` + `deploy/lode.toml`.
- Drive search (`drive/index.ts`) and the aggregated trash listing
  (`drive.routes.ts`) resolve a user's projects through `listProjects` with a
  hard `limit: 100`, silently truncating users in more than 100 projects; the
  trash route also re-resolves each project id one query at a time.
- The web coverage floor (38 / 33) sits far below the measured 52 / 46, so it
  no longer guards anything.

## Scope

- Docs rewritten against the actual files; no behaviour change.
- `listMemberProjects(db, userId)` in `project.service.ts` (internal ids and
  names, not soft-deleted, no cap); both drive call sites use it.
- Thresholds raised to about four points under the measured values.

Explicitly out of scope: the `tally.so` CSP allowance (product decision),
wiring `tests/smoke` into CI, and cleaning local artefacts (`core`,
`backup/`).

## Verification

- RED: `project.service.test.ts` asserts the helper returns every membership
  past the old page cap.
- Existing `trash/all` and drive search tests unchanged and green.
- `bun run check` EXIT 0.
