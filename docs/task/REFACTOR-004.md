# REFACTOR-004 Remove the ship lifecycle concept (keep status only)

- Status: Done
- Plan: -
- Updated: 2026-05-28

## Goal

The fleet (ship) module carried two parallel state concepts: `status`
(`active` / `archived`) and `lifecycleStage` (`design` … `decommissioned`).
The fleet has no lifecycle, only a status. Remove the lifecycle concept
end-to-end and keep `status` as the single state.

## Scope

- API: drop `lifecycle_stage` column + `SHIP_LIFECYCLE_STAGES` enum/type from
  `schema.ts`; remove it from `ship.service.ts` (view, create/update inputs,
  list filter, updatable keys) and `ship.routes.ts` (schemas + query param);
  update `ship.service.test.ts`. Generate the drop-column migration via
  drizzle-kit.
- Web: drop `ShipLifecycleStage` / `SHIP_LIFECYCLE_STAGES` and `lifecycleStage`
  from `ships.ts`; delete `LIFECYCLE_STYLES` (`-ship-colors.ts`) and
  `LifecycleBadge` (`-ship-visuals.tsx`); remove the lifecycle field, the
  lifecycle card + `LifecycleStepper` from `-ship-overview-tab.tsx`; remove the
  lifecycle field from `-ship-profile-tab.tsx`; remove the lifecycle Select from
  `-ship-form-dialog.tsx` and `-ship-form-logic.ts`. List page (`index.lazy.tsx`)
  filter switches from lifecycle stage to **status** (All / Active / Archived);
  card + detail-header badges switch from `LifecycleBadge` to `ShipStatusBadge`.
  Remove lifecycle i18n keys (zh/en).
- Seed + fixtures + e2e: drop `lifecycle` / `lifecycleStage`.

Decision: list filter = status (A1); badges = `ShipStatusBadge` (B1).

## Verification

- `bun run check` passes.
- Ship unit tests, web list/overview/profile/form tests, and the ship e2e flow
  pass with no lifecycle references remaining.
