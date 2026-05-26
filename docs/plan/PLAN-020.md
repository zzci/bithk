# PLAN-020 Repeatable database seed script

- **status**: completed
- **createdAt**: 2026-05-25
- **approvedAt**: 2026-05-25
- **relatedTask**: CHORE-001

## Context

The API stores everything in a single SQLite file (`apps/api/src/db/index.ts`,
`createDb(path)` runs migrations on open). Schema is aggregated in
`apps/api/src/db/schema.ts` across ~17 modules. IDs are app-generated
(`@/shared/lib/id`: `ulid()` for internal ids, 8-char `nanoid()` for `shortId`).

Rich creators already exist and own the per-row defaults and dependent rows:

- `contact.service.ts` — `createContact`
- `ship.service.ts` — `createShip`, plus equipment / maintenance-template creators
- `project.service.ts` — `createProject` (auto-creates default roles + members),
  `addMember`, procurement-category creator
- `issue.service.ts` — `createIssue`
- `procurement.service.ts` — `createProcurement`
- `document.service.ts` — `createDocument`

Users are provisioned via OAuth/single-user flow — there is no `createUser`
service — so seed users must be inserted directly into `users`.

There is no existing seed script; `package.json` has no `seed` task.

## Proposal

Add `scripts/seed.ts` and a `seed` script in root `package.json`.

1. **DB resolution**: read `DB_PATH` from `Bun.env` (default `data/db/app.db`),
   resolve against `ROOT_DIR`, call `createDb(path)` so migrations run. Do not
   call `loadConfig()` (avoids OIDC discovery + production sentinels).
2. **Flags**: `--fresh` deletes seeded rows (by deterministic seed IDs) before
   inserting; default run is idempotent via fixed IDs + `onConflictDoNothing`.
3. **Seed data** (fixed deterministic IDs, prefix `seed-…`), in FK order:
   - 4 users: 1 admin + 3 regular (direct insert into `users`).
   - tags (direct insert), contacts (suppliers/clients) via `createContact`.
   - 2 ships via `createShip` + a little equipment.
   - 2 projects via `createProject`; add the seed users as members; add a couple
     of procurement categories; bind one project to a ship.
   - several issues via `createIssue` (varied priority/status, some assigned).
   - a few procurement records via `createProcurement`.
   - a few documents via `createDocument`.
4. **Output**: print a short summary (counts + a login hint for the admin user).
5. Reuse service creators everywhere one exists; direct insert only for
   `users` and `tags`. This keeps the script in sync with schema/business
   defaults automatically.

## Risks

- Service creators may assume an actor/permission context. Mitigation: they all
  take `(db, input)` only (verified by signature scan); confirm at implementation
  and fall back to direct insert if any creator needs request context.
- `--fresh` could touch a developer's real login row. Mitigation: only delete
  rows whose IDs carry the `seed-` prefix; never wipe the whole DB file.
- Idempotency relies on stable IDs; service creators that mint their own ULIDs
  may not support `onConflictDoNothing`. Mitigation: gate creation on an
  existence check (skip if a known seed marker row already exists).

## Scope

One new file (`scripts/seed.ts`, target < 300 lines) + one `package.json` line.
No schema, migration, or production-code changes.

## Alternatives

- **Raw direct inserts for every table**: more code, must replicate every
  default, and drifts from business rules. Rejected in favor of reusing creators.
- **SQL fixture file**: brittle against migrations and app-generated IDs.
  Rejected.

## Annotations

- 2026-05-25: Approved ("开始处理"). Implemented at `apps/api/scripts/seed.ts`
  (not `scripts/seed.ts` as drafted) so the `@/` path alias resolves under the
  api workspace, mirroring `apps/api/scripts/gen-api-docs.ts`.
- 2026-05-25: `--fresh` wipe needed `PRAGMA defer_foreign_keys = ON` inside one
  transaction — the migration's NO-ACTION `projects.ship_id` FK forms a delete
  cycle with `ships.base_project_id`. Schema/migration drift noted in CHORE-001
  for a possible follow-up; not fixed here (out of scope). Verified seed,
  idempotent re-run, and reseed; typecheck + lint green.
