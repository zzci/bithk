# REFACTOR-023 Migrate ships tag surfaces to shared family

- Status: Completed
- Plan: [PLAN-066](../plan/PLAN-066.md)
- Owner: BKD L3 7lmp8t6x (campaign l1-75ymcfnr-gtag-20260603191645)
- Campaign: l1-75ymcfnr-gtag-20260603191645
- Depends on: [REFACTOR-020](REFACTOR-020.md)
- Updated: 2026-06-03

## Goal

Migrate all ships-module tag surfaces to the shared `shared/components/tags/`
family, then delete the ship-local adapter.

## Scope (edit only — `routes/_app/ships/**`)

- `index.lazy.tsx` — card display `TagBadgeList` + hand-written badges →
  `TagChips`; tag filter dimension → `tagFilterDimension` (hide-when-empty).
- `-ship-form-dialog.tsx` — `ShipTagsCombobox` → `TagInput`
  (`namespace="ships"`, `suggestions={availableTags}`).
- DELETE `-ship-tags-combobox.tsx` (adapter).

## Acceptance

- Every ship tag chip, picker, and filter uses the family.
- No remaining import of `TagBadgeList` or `-ship-tags-combobox` under `ships/`.
- `bun run check` EXIT 0 (modulo @milkdown flake); behavior parity.

> **Completed 2026-06-03** — L3 `bkd/7lmp8t6x` migration commit `4e93225`
> cherry-picked (`-x`) into `bkd/lc757j1x` @f7e24af (3 ships files; adapter
> deleted). Verified: web typecheck EXIT 0 + ships/tags targeted tests 68/68.
> Cherry-pick (not branch merge) used because BKD branched the L3 from a moved
> main (foreign isstag campaign @178af74); keeps `bkd/lc757j1x` isolated.
