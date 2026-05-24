# 004 — Ship/project cycle handling in schema and backup restore

- Status: accepted
- Date: 2026-05-24
- Review by: 2026-11-24
- Scope: ship/project schema migration and backup module dependency ordering

## Context

Ships and projects intentionally reference each other:

- `ships.base_project_id` points at the base project that carries ship
  permissions and files.
- `projects.ship_id` points back at the owning ship for the base project and
  any additionally bound project.

This creates two implementation constraints. First, the Drizzle-generated
`ALTER TABLE projects ADD ship_id text REFERENCES ships(id)` migration cannot
express `ON DELETE SET NULL` for the added foreign-key column even though the
schema model declares it. Second, backup module dependencies can form a
`projects <-> ships` cycle.

## Decision

Accept the generated migration as-is for `projects.ship_id`. Ships are
soft-deleted only; `softDeleteShip` explicitly clears `projects.ship_id` and
`ships.base_project_id`, so hard-delete cascade semantics are not part of the
runtime contract.

Backup dependency resolution uses a visiting-set guard to tolerate cycles and
include each module once. Restore runs inside one transaction with
`PRAGMA defer_foreign_keys = 1`, so the ship/project rows can be inserted in a
cycle-safe order and validated at commit.

## Consequences

- The database schema snapshot and runtime schema do not have identical
  delete-action text for `projects.ship_id`.
- Hard-deleting a ship row directly in SQLite is outside the supported runtime
  path and may not null project links automatically.
- Backup restore remains deterministic for the selected module closure while
  still allowing the ship/project circular relation.

## Review

Revisit by **2026-11-24**, or sooner if ships move from soft-delete-only to
physical deletion. At that point, replace the generated migration strategy or
add an explicit follow-up migration so `projects.ship_id` carries the intended
delete action in SQLite.
