# PLAN-093 Procurement status transitions + rename confirmed to paid

- **status**: completed
- **createdAt**: 2026-06-19 00:00
- **approvedAt**: 2026-06-19 00:00
- **relatedTask**: FEAT-041

## Context

Procurement status enum (`apps/api/src/modules/procurement/schema.ts:6`):
`requested, ordered, confirmed, in_transit, received, accepted, cancelled`.
`items.status` is plain `text().notNull()` — no DB CHECK constraint, so renaming
a value is code-only (no migration); existing dev rows realign on `bun run seed`.
Status changes go through `changeStatus` (`procurement.service.ts:363`), which
loads the row, captures `previous = item.status`, then updates unconditionally —
transitions are currently **free** (asserted by routes-test "free transitions"
line 417 and service-test "status free transitions (lock-in)" line 483).

`paid` already exists as a status value in HR payroll, so the vocabulary is
consistent. The FEAT-040 confirm-lock keys off `PROCUREMENT_EDITABLE_STATUSES =
[requested, ordered]` (not the name `confirmed`), so the rename leaves locking
unchanged.

## Proposal

### Rename `confirmed` → `paid`

- `schema.ts`: enum array value.
- web `procurement.ts`: `ProcurementStatus` union + `PROCUREMENT_STATUSES`.
- web `status-colors.ts`: `PROCUREMENT_STATUS_BADGE` key (keep the same primary
  tint).
- i18n en/zh `projects.json`: `status.confirmed` → `status.paid` ("Paid" /
  "已付款").
- seed `procurement-templates.json`: the one `"status": "confirmed"` → `"paid"`.
- Refresh comments/the lock message that say "confirmed" to "paid".

### Transition rules

Add to `schema.ts` (and mirror in web `procurement.ts`):

```ts
export function isAllowedProcurementTransition(from: ProcurementStatus, to: ProcurementStatus): boolean {
  if (from === "paid" && (to === "requested" || to === "ordered")) return false;
  if ((from === "received" || from === "accepted") && to === "cancelled") return false;
  return true;
}
```

- `changeStatus`: after computing `previous`, if
  `!isAllowedProcurementTransition(previous, newStatus)` throw
  `AppError("Cannot change procurement status from <previous> to <next>", 409,
  "PROCUREMENT_INVALID_TRANSITION")`. Self-transition (`from === to`) stays
  allowed, matching current version-bump behaviour.
- `procurement.routes.ts`: add a `409` response entry to the status route's
  `describeRoute`.
- web panel: status `MetaSelectBadge` options become
  `PROCUREMENT_STATUSES.filter(s => isAllowedProcurementTransition(current, s))`
  (keeps the current status, since `from === to` is allowed) so the dropdown
  never offers a transition the API would reject.

### Tests

- Rewrite routes-test "free transitions" → a valid tour + explicit 409s
  (`paid→ordered`, `paid→requested`, `received→cancelled`, `accepted→cancelled`).
- Rewrite service-test "status free transitions (lock-in)" → a valid tour
  honouring the rules + direct `changeStatus` rejections for the forbidden pairs.
- Update the routes-test lock case and the web panel lock test to use `paid`.
- Add a web panel test: from `paid` the picker omits "Ordered"; from `received`
  it omits "Cancelled".

## Risks

- The rename desyncs any pre-existing `confirmed` rows in a running dev DB until
  reseed — acceptable (template/personal project; reseed is the standard reset).
  No production data.
- The transition guard changes long-standing "free transition" semantics; the
  two affected tests are rewritten deliberately, not deleted.
- `changeStatus` is only called from the status route (not seed/backup, which
  set status directly), so the guard cannot block restores.

## Scope

~4 backend files + 2 backend test files + seed payload; ~3 web files + 1 web
test; 2 i18n files; regenerated api-spec; changelog. No migration.

## Alternatives

- Keep the value `confirmed`, relabel only — rejected: "paid" is the real concept
  and is already a value used by HR payroll; a clean value rename avoids a
  permanent label/value mismatch (no migration cost here since status is free
  text).
- Enforce a full monotonic state machine — rejected: out of scope; only the two
  stated rules are enforced, all other transitions stay free.

## Annotations

- 2026-06-19: User specified: after confirmed/paid the status may not go back to
  ordered/requested; received/accepted may not be cancelled; rename 已确认 →
  已付款. Confirmed (via "proceed"): full value rename `confirmed`→`paid`, and
  forward progress from `paid` stays allowed ("only cancel" reading = no
  regression to pre-payment states, not "cancel is the sole option").
- 2026-06-19 (revision): User reversed the rename — **keep `confirmed`, add a
  separate `paid`** after it (8-status lifecycle). The "确认后" lock + no-regress
  rules now key off `confirmed` (the earlier committed state); `paid` is a later
  milestone that inherits both. `isAllowedProcurementTransition` generalised to
  "any committed state (not requested/ordered/cancelled) cannot regress to
  ordered/requested". Status colour: confirmed = primary tint, paid = primary
  solid. Seed keeps one `confirmed` + one `paid` example. No migration (free-text
  status); dev DB reseed realigns old rows.
