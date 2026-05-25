# CHORE-001 Add a repeatable database seed script for testing

- **status**: in_progress
- **priority**: P2
- **owner**: seed-script
- **createdAt**: 2026-05-25

## Description

Provide a `scripts/seed.ts` that populates a local SQLite database with coherent
demo data across the main user-facing modules (accounts, contacts, ships,
projects + members + procurement categories, issues, procurement, documents,
tags), so the app can be exercised end-to-end during development.

Acceptance criteria:

- `bun run seed` creates a fully usable dataset against the configured `DB_PATH`.
- The script is repeatable: re-running it does not duplicate rows or error out.
- A `--fresh` flag wipes existing seeded data before reseeding.
- Foreign-key order is respected; data is inserted through existing service-layer
  creators where they exist (projects, ships, issues, procurement, documents,
  contacts) and via direct inserts only where no creator exists (users, tags).
- `bun run lint` and `bun run typecheck` pass for the new script.

## ActiveForm

Building a repeatable seed-data script for local testing.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Research-stage project; destructive changes are acceptable. See PLAN-020.
