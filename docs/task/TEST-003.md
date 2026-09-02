# TEST-003 - e2e specs still target the pre-PLAN-108 ship and module surface

- Status: Completed (2026-09-01)
- Plan: [PLAN-111](../plan/PLAN-111.md) (closing verification)
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-01

## Goal

The full e2e run that closes PLAN-111 exposed harness drift left behind by
the projects-as-sections fold (PLAN-108 / TEST-002): `lib/grant.ts` granted
the removed `ships` module key (no suite ran at all), `search.test.ts`
expected a `ships` result bucket, and `ship/main-flow.test.ts` still drove
`POST /api/ships` — the only e2e coverage of the ship section routes.
`drive/backup.test.ts` also used the v1 JSON export retired by FIX-072.

## Scope

- `grant.ts` and `search.test.ts`: drop `ships`.
- `drive/backup.test.ts`: v2 export job + gzip inflate instead of
  `/api/backup/export`.
- `ship/main-flow.test.ts`: port to the section routes — create a project
  with the `ship` preset, read / update `ship-profile`, equipment and
  equipment categories, copy a global worklist into the project and
  reference it from a work order, project files — keeping the permission
  matrix (non-member 404, Reader 403 on writes, Owner writes, anonymous 401).

## Verification

- `bun run test:e2e` all phases green.

## Notes

- 2026-09-01: `bun run test:e2e` — 105 / 105 pass across every phase after the port.
