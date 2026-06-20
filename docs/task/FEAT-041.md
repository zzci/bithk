# FEAT-041 - Procurement status transitions + rename confirmed to paid

- Status: Completed
- Plan: [PLAN-093](../plan/PLAN-093.md)
- Campaign: local
- Owner: session
- Created: 2026-06-19

## Summary

Two related procurement-status changes:

1. **Rename the `confirmed` status to `paid`** (已确认 → 已付款) across the enum
   value, labels, status colour, and seed data.
2. **Constrain status transitions** (currently fully free) with two business
   rules, enforced on the backend and reflected in the panel's status picker.

## Acceptance Criteria

- The procurement status value `confirmed` becomes `paid` everywhere: API enum
  (`schema.ts`), web enum/type (`procurement.ts`), status colour map
  (`status-colors.ts`), en/zh labels (`status.paid` → "Paid" / "已付款"), and the
  seed payload. No DB migration (status is free text); dev data realigns on
  reseed.
- Transition rules (enforced in `changeStatus`, 409 on violation):
  - From `paid`, the status cannot return to `ordered` or `requested`.
  - From `received` or `accepted`, the status cannot become `cancelled`.
  - All other transitions remain allowed (forward progress included).
- The panel's status dropdown only offers transitions allowed from the current
  status (mirrors the backend rule via a shared-shaped helper on each side).
- Backend rejects a forbidden transition with
  `409 PROCUREMENT_INVALID_TRANSITION`; the existing "free transitions" route +
  service tests are rewritten to the new rules, plus explicit forbidden-case
  tests.
- `bun run check` passes; OpenAPI spec regenerated (409 on the status route).

## Files in Scope

- `apps/api/src/modules/procurement/schema.ts` (rename + `isAllowedProcurementTransition`)
- `apps/api/src/modules/procurement/procurement.service.ts` (`changeStatus` guard)
- `apps/api/src/modules/procurement/procurement.routes.ts` (409 response doc)
- `apps/api/src/modules/procurement/procurement.{routes,service}.test.ts`
- `apps/api/scripts/seed/payload/procurement-templates.json`
- `apps/web/src/shared/lib/api/procurement.ts` (rename + transition helper)
- `apps/web/src/shared/lib/status-colors.ts`
- `apps/web/src/app/routes/_app/projects/-project-procurement-panel.tsx` (filter options)
- `apps/web/src/app/routes/_app/projects/-project-procurement-panel.test.tsx`
- `apps/web/src/locales/{en,zh}/projects.json`
- `skills/bithk/references/api-spec.json` (generated)
- `docs/changelog.md`

## Dependencies

- Follows [FEAT-040](FEAT-040.md) (procurement drawer form + confirm-lock). The
  confirm-lock helper keys off `requested`/`ordered`, so the rename leaves the
  lock behaviour unchanged (paid and beyond stay locked).

## Status Notes

- 2026-06-19: Created with [PLAN-093](../plan/PLAN-093.md); approved, implementation started.
- 2026-06-19: Completed. Renamed `confirmed`→`paid` across api/web enums, i18n
  (Paid/已付款), status colour, and the seed payload (no migration; status is free
  text). Added `isAllowedProcurementTransition` (api `schema.ts` + mirrored in web
  `procurement.ts`); `changeStatus` rejects forbidden transitions with
  `409 PROCUREMENT_INVALID_TRANSITION`; the panel status picker filters options to
  allowed targets. Tests: rewrote the routes + service "free transitions" tests to
  the new rules and added forbidden-case coverage; updated web panel + the
  status-colors / procurement enum unit tests; api 62 / web 30 procurement tests
  pass. Regenerated api-spec (status route 409). `bun run check` EXIT 0. Note: dev
  DB needs `bun run seed` to realign old `confirmed` rows.
- 2026-06-19: Revised per user — instead of renaming, **keep `confirmed` and add a
  new `paid` status after it** (lifecycle: requested → ordered → confirmed → paid →
  in_transit → received → accepted; + cancelled). Item-detail lock and the
  no-regress transition rule now apply from `confirmed` onward (paid inherits both);
  `received`/`accepted` still cannot be cancelled. Updated enum/i18n/colour
  (confirmed = primary tint, paid = primary solid)/seed (one confirmed + one paid
  template) + routes/service/panel/unit tests (api 62, web 49 pass). Spec
  committed without the concurrent FEAT-042 `/account/groups/default` path (that
  route's mounting is not in this commit).
- 2026-06-20: Added the reversal sub-flow — two new statuses **`returned`
  (已退货)** and **`refunded` (已退款)** after `accepted` (lifecycle: … → accepted →
  returned → refunded; + cancelled). Returning is optional: with goods returned
  it's accepted → returned → refunded, otherwise received/accepted → refunded
  directly. No transition-helper change needed — both are "committed" states, so
  they already block regress to ordered/requested and are reachable from
  received/accepted (which still cannot be `cancelled`, using return/refund as the
  proper reversal). Colour: destructive tint (returned) / stronger destructive
  tint (refunded). Updated enum/i18n/colour/seed (+1 returned, +1 refunded
  template) + enum/colour unit tests + a routes flow test (api 63, web 49 pass).
