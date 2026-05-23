# 002 — Procurement status is a free-transition manual tracker, not a state machine

- Status: accepted
- Date: 2026-05-23
- Review by: 2026-11-23
- Scope: `apps/api` procurement module (`procurement.service.ts` `changeStatus`,
  `procurement.routes.ts` status endpoint, `PROCUREMENT_STATUSES`)

## Context

Procurement records carry a `status` drawn from
`PROCUREMENT_STATUSES = ["draft", "requested", "ordered", "received", "closed"]`.
Reviewers asked whether `changeStatus` should enforce a directed state machine
(e.g. only `draft -> requested -> ordered -> received -> closed`, no going
back, `closed` terminal).

## Decision

Procurement status is an **intentional free-transition manual tracker**: any
status may move to any other status, including moving backward and moving back
**out of** `closed`. It is **not** a state machine and no transition graph is
enforced.

Guard rails that DO apply:

- The target status is validated against `PROCUREMENT_STATUSES` at two layers:
  the zod enum at the route boundary (`statusSchema`, rejects with `422`) and
  the `isProcurementStatus` guard inside `changeStatus` (throws
  `ValidationError`).
- Every transition bumps `items.version` and emits a fully-audited
  `procurement.status_changed` event carrying `{ from, to }`.
- Changing status requires the `procurement.manage` capability (or app admin);
  callers without it get a fail-closed `404`.

## Rationale

Construction procurement tracking is operator-driven and corrections are
routine (a record is reopened after a mistaken close, an order reverts to
`draft` for re-spec, etc.). A rigid graph would force awkward workarounds
without adding integrity value, because the audit trail already records who
changed what, when, and from/to. Validity is bounded by the enum; ordering is a
human workflow concern, not a data-integrity invariant.

## Sunset / review

Revisit by **2026-11-23**, or sooner if a concrete reporting/compliance
requirement emerges that depends on enforced ordering. If a state machine is
ever introduced, the lock-in tests in
`procurement.service.test.ts` ("status free transitions (lock-in)") and
`procurement.routes.test.ts` ("free transitions") must be updated in the same
change so the deviation is removed deliberately, not by accident.
