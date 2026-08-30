# DATA-002 - Reseed for the section model: every mounted surface needs data

- Status: Completed (2026-08-29)
- Plan: -
- Created: 2026-08-28

## Goal

PLAN-108 replaced "a project is a fixed thing" with "a project is a core record
plus a mounted set of sections". The seed was adapted structurally — projects
are created through the real create path and the mount-integrity check passes —
but the **data** it produces still describes the old world: two fixed shapes
(the `general` preset and the `ship` preset), and several mounted sections that
carry nothing at all.

Two concrete gaps, both verified:

- **Files is mounted on all 30 projects and empty on all 30.**
  `apps/api/scripts/seed/payload/drive.json` only carries `ownerType` values
  `team_directory` and `user` — not one project-owned entry exists.
- **Nothing exercises composability.** `projects.json` has no per-project
  section or preset field, so every seeded project is exactly one of the two
  presets. The central claim of the new model — that sections are mounted per
  project, not implied by a type — is never demonstrated by the seeded data.

## Scope

- Audit every section against what the seed actually produces and classify it
  representative / thin / empty. Fill what is empty; report what is merely thin
  rather than padding it.
- Seed project-owned drive content for both general and ship-preset projects,
  through the real service creators: nested folders, files with real bytes, an
  entry with an extra version, a project-scoped share.
- Seed at least one project whose mounted sections are **not** either preset —
  e.g. a general project with `equipment` mounted, or a ship project with a
  section left off — with data in the non-default section, so the composable
  model is represented in the data and not only in the schema.
- Support per-project section sets in the payload format, so future seed data
  can express any mount combination without a code change.

Out of scope: changing the drive or section code, and rebalancing seed volumes
that are merely thin rather than empty (38 equipment rows across 22 ships is
thin but not broken — report it, do not fix it here).

## Verification

- `bun run seed` EXIT 0, with the mount-integrity check still passing.
- The seed summary reports project-owned drive entries as its own line.
- A freshly seeded general project AND a freshly seeded ship project each show
  a populated Files tab, with nesting visible.
- `bun run check` EXIT 0.
