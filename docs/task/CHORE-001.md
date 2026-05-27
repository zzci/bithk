# CHORE-001 Add a repeatable database seed script for testing

- **status**: completed
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

Implemented as `apps/api/scripts/seed.ts` (lives under the api workspace so the
`@/` alias resolves) with `seed` scripts wired into both `apps/api/package.json`
and root `package.json`. Verified: initial seed, idempotent re-run, and `--fresh`
reseed produce stable row counts with no duplication. `typecheck` and `lint` pass.

Notable finding: the generated migration added `projects.ship_id` as a plain
`REFERENCES ships(id)` with no `ON DELETE` (NO ACTION), diverging from the TS
schema's `set null`. This creates a `ships.base_project_id ↔ projects.ship_id`
delete cycle; `--fresh` works around it with a single transaction under
`PRAGMA defer_foreign_keys = ON`. The schema/migration drift itself is left
untouched (out of scope) but worth a follow-up.

Follow-up from running against the real dev DB: the seed admin originally used
username `admin`, which collides with the single-user `admin` account, so
`onConflictDoNothing` silently skipped the row and a dependent relation-tuple
insert then failed on the `created_by` FK. Fixed by namespacing all seed
usernames (`seed-admin`/`seed-pm`/…) and adding a post-insert check that fails
fast if any seed user is missing. `--fresh` only removes `seed-`-owned rows, so
pre-existing dev data created by real accounts is preserved. Seeded the dev DB
at `data/db/app.db`.

Scaled up (~10x): `seedContent` now generates data from fixed vocab pools via a
seeded PRNG, driven by a `COUNTS` table (default ~20 users, 30 contacts, 20
ships, 10 standalone projects, 30 issues, 20 procurements, 20 documents). Output
stays reproducible across `--fresh` runs. Reseeded the dev DB. Note: the
single-user `admin` row is auto-provisioned at login and is not seed data, so it
regenerates on next dev login.

Cover images: ~70% of ships and standalone projects get a cover fetched from
picsum.photos and stored through the real file pipeline (`loadConfigStrict` +
`initFileModule`, then `setShipCover` / `setProjectCover`); the rest are left
without one, and base projects inherit their ship's cover. Fetch failures are
non-fatal (covers skipped when offline). Cover `file_references` / `files` are
owned by seed users (`created_by` / `uploaded_by`), so the existing `--fresh`
user-cascade cleans them with no wipe change (verified: no row leak across
reseeds; on-disk blobs are content-addressed and deduped).
