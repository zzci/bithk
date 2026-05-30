# CHORE-002 Rebuild the Drizzle migration baseline

- **status**: in_progress
- **priority**: P1
- **owner**: db-migration-reset
- **createdAt**: 2026-05-28 22:45

## Description

Replace the existing generated Drizzle migration history with a new single
baseline migration generated from the current TypeScript schema.

Acceptance criteria:

- Existing generated files under `apps/api/drizzle/` are removed.
- A new migration is generated through `drizzle-kit generate`; migration SQL is
  not hand-written.
- The generated migration can initialize a fresh SQLite database through the
  normal API `createDb` path.
- Existing unrelated work in progress is not reverted or reformatted.

## ActiveForm

Rebuilding the Drizzle migration baseline.

## Dependencies

- **blocked by**: explicit approval after PLAN-030 proposal
- **blocks**: (none)

## Notes

- 2026-05-28 22:45 - Investigation found two existing generated migrations:
  `0000_uneven_swarm.sql` and `0001_skinny_the_twelve.sql`, plus matching
  Drizzle snapshot/journal files. The current repo is still in development and
  the user explicitly accepts breaking database history.
