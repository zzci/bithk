# REFACTOR-023 Migrate ships tag surfaces to shared family

- Status: Todo
- Plan: [PLAN-062](../plan/PLAN-062.md)
- Owner: BKD L3 (campaign l1-75ymcfnr-gtag-20260603191645)
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

> Full self-contained implementation spec delivered to the L3 via BKD follow-up.
