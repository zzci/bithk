# REFACTOR-034 - Extract services from oversized route files; fix non-tx cascades

- Status: Completed
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3
- Created: 2026-07-02

## Summary

Route files that grew into services, plus two transactional gaps. See
AUDIT-20260702-architecture.md → D7.

- `account/auth/auth.routes.ts` (899): in-file rate limiter + lockout state machine (130-220,
  exports test hooks) + ~160-line OIDC callback (from 351) → extract to
  `auth.service.ts`/`lockout.service.ts`.
- `cron/cron.routes.ts`: direct drizzle at 315/368/535/583/628 + inline create workflow → move
  CRUD into `cron.service.ts`.
- `account/users/users.routes.ts`: raw db at 197/248/602 → `users.service.ts`.
- `document.routes.ts:501-514`: cascade delete in handler, per-descendant N+1, no transaction →
  move into `document.service.ts`, batch with `inArray`, one tx.
- `drive.service.ts:743-779` `purgeEntries`: wrap entry delete + share/ref cleanup in a tx; batch
  share deletion.

## Acceptance Criteria

- Behavior-preserving extraction: same status codes, envelopes, audit events, rate-limit/lockout
  semantics (move tests along; route files shed the extracted logic).
- Document cascade delete and `purgeEntries` are atomic; a mid-failure leaves no orphaned
  shares/references (add a regression test for each).
- `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/account/auth/*`, `account/users/*`, `cron/*`, `document/*`, `drive/*`
  and their co-located tests.

## Status Notes

- 2026-07-02: Completed — auth/cron/users route logic extracted into services; document cascade
  delete and drive `purgeEntries` now run batched inside single transactions with regression
  tests.
