# 004 — Ship/project cycle handling in schema and backup restore

- Status: Superseded by [ADR-015 — Projects are compositions of mounted sections; ships are a preset](./015-projects-as-sections.md) (2026-08-28)
- Date: 2026-05-24
- Superseded: 2026-08-28
- Scope: ship/project schema migration and backup module dependency ordering

## Superseded

[ADR-015](./015-projects-as-sections.md) folded ships into projects: a project
is a core record plus a set of mounted sections, and a project that mounts
`ship-profile` **is** a ship. The `ships` table and `projects.ship_id` are both
gone, so neither of the two constraints this decision existed to handle still
applies — there is no generated `ALTER TABLE projects ADD ship_id` migration to
accept, and the backup `projects <-> ships` dependency cycle is now a one-way
edge (`projects` deps `[users, tags]`, `ships` deps `[users, projects]`).

The cycle tolerance this decision introduced is kept in the backup module — the
visiting-set guard and the `PRAGMA defer_foreign_keys = 1` restore transaction
are still correct and still protect any future cycle — but they are no longer
load-bearing for projects and ships.

The rest of this document is retained as the historical record of the pre-fold
schema.

## Context (historical)

Ships and projects intentionally referenced each other:

- `ships.base_project_id` points at the base project that carries ship
  permissions and files.
- `projects.ship_id` points back at the owning ship for the base project and
  any additionally bound project.

This creates two implementation constraints. First, the Drizzle-generated
`ALTER TABLE projects ADD ship_id text REFERENCES ships(id)` migration cannot
express `ON DELETE SET NULL` for the added foreign-key column even though the
schema model declares it. Second, backup module dependencies can form a
`projects <-> ships` cycle.

## Decision (historical)

Accept the generated migration as-is for `projects.ship_id`. Ships are
soft-deleted only; `softDeleteShip` explicitly clears `projects.ship_id` and
`ships.base_project_id`, so hard-delete cascade semantics are not part of the
runtime contract.

Backup dependency resolution uses a visiting-set guard to tolerate cycles and
include each module once. Restore runs inside one transaction with
`PRAGMA defer_foreign_keys = 1`, so the ship/project rows can be inserted in a
cycle-safe order and validated at commit.

## Consequences (historical)

- The database schema snapshot and runtime schema do not have identical
  delete-action text for `projects.ship_id`.
- Hard-deleting a ship row directly in SQLite is outside the supported runtime
  path and may not null project links automatically.
- Backup restore remains deterministic for the selected module closure while
  still allowing the ship/project circular relation.

## Review

Closed. No further review: the schema this decision described no longer exists.
See [ADR-015](./015-projects-as-sections.md) for the current model.
