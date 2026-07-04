# REFACTOR-036 - Final migration collapse to a fresh 0000 baseline

- Status: Completed
- Plan: [PLAN-105](../plan/PLAN-105.md)
- Created: 2026-07-04

## Summary

Migrations 0000_mighty_havok .. 0008_drive_timestamps_backfill collapse into a single freshly
generated 0000 baseline (same procedure as the previous collapse; old lineage is preserved under
backup/). The 0008 data backfill is intentionally dropped — a fresh DB has no legacy rows and new
rows get ISO defaults from the schema.

## Acceptance Criteria

- `apps/api/drizzle/` contains exactly one migration + matching journal/snapshot, all generated
  by drizzle-kit (no hand-authored SQL).
- Post-collapse `db:generate` reports no schema drift (no new migration emitted).
- `db/migrations.test.ts` replay passes; `bun run seed` builds a working fresh DB.
- `bun run check` passes.
- Old migration set backed up outside `apps/api/drizzle/` before wipe.

## Caveat

Collapsing resets the migration lineage: any existing DB that already applied 0000-0008 cannot
replay the new baseline. Dev DBs are reset via seed; deployed instances must be restored via
backup import (established by the previous collapse precedent).

## Status Notes

- 2026-07-04: Completed — 9 migrations collapsed to generated baseline 0000_fluffy_zaladane;
  no-drift verified by second generate; full check EXIT 0; old set backed up to
  backup/drizzle-pre-collapse-20260704/ (gitignored; history retains the originals).
