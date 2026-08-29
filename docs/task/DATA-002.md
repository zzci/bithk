# DATA-002 - Seed leaves every project's Files tab empty

- Status: In Progress
- Plan: -
- Created: 2026-08-28

## Goal

`bun run seed` builds 30 projects (22 ship-preset, 8 general) and mounts the
`files` section on every one of them, but the drive payload only contains
`user` and `team_directory` owners — there is not a single project-owned
entry. Every project's Files tab therefore renders an empty state in a freshly
seeded database, which is what makes the tab look broken rather than merely
empty.

Verified on `apps/api/scripts/seed/payload/drive.json`: `ownerType` values are
`["team_directory", "user"]`, no `project` owner anywhere.

## Scope

- Seed project-owned drive content for a representative subset of projects —
  both general and ship-preset — through the real service creators, the way
  the rest of the seed works. No hand-inserted rows.
- Content should exercise what the tab actually renders: nested folders, a
  handful of files with real bytes, at least one entry with an extra version,
  and at least one project-scoped share.
- Audit the rest of the seed against the post-PLAN-108 model while there: for
  every section that mounts, report whether it seeds representative data or
  lands empty. Fill the gaps that matter; report the ones that do not rather
  than padding arbitrarily.

Out of scope: changing the drive or section code, and rebalancing seed volumes
that are merely thin rather than empty (38 equipment rows across 22 ships is
thin but not broken — report it, do not fix it here).

## Verification

- `bun run seed` EXIT 0, with the mount-integrity check still passing.
- The seed summary reports project-owned drive entries as its own line.
- A freshly seeded general project AND a freshly seeded ship project each show
  a populated Files tab, with nesting visible.
- `bun run check` EXIT 0.
