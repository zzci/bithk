# TEST-001 - Close the HTTP-behavior coverage gap for auth-sensitive modules

- Status: In Progress
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3 (wave 3 — after route-file surgery settles)
- Created: 2026-07-02

## Summary

`apps/api/bunfig.toml` excludes `*.routes.ts` from coverage on the premise "e2e is the
system-of-record for HTTP behaviour", but 10 of 22 modules have zero e2e and `document` has zero
route tests. Priority (auth-sensitive): file, share, project, procurement, hr. See
AUDIT-20260702-architecture.md → D14.

## Acceptance Criteria

- e2e module suites (tests/e2e/modules/, registered in `MODULE_DIRS`) or in-process
  `.routes.test.ts` added for: file, share, project, procurement, hr, document — covering at
  minimum: authz denial paths (non-member/non-owner 403/404), happy-path CRUD, and one
  attachment flow per host module.
- `bun run test:e2e` passes (pre-existing failures, if any, documented and not increased).
- `bun run check` passes.

## Files in Scope

- `tests/e2e/modules/*`, `tests/e2e/run.ts` (MODULE_DIRS), or
  `apps/api/src/modules/{file,share,project,procurement,hr,document}/*.routes.test.ts`.
