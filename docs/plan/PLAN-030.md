# PLAN-030 Drizzle migration baseline rebuild

- **status**: draft
- **createdAt**: 2026-05-28 22:45
- **approvedAt**: (pending)
- **relatedTask**: CHORE-002

## Context

The API uses Drizzle with SQLite:

- `apps/api/drizzle.config.ts` points Drizzle Kit at
  `apps/api/src/db/schema.ts` and emits generated migrations under
  `apps/api/drizzle/`.
- `apps/api/src/db/index.ts` applies migrations from
  `apps/api/drizzle/meta/_journal.json` during `createDb`.
- The current schema aggregate re-exports module schema definitions from
  `apps/api/src/modules/**/schema.ts`.
- Existing generated migration files are:
  - `apps/api/drizzle/0000_uneven_swarm.sql`
  - `apps/api/drizzle/0001_skinny_the_twelve.sql`
  - `apps/api/drizzle/meta/0000_snapshot.json`
  - `apps/api/drizzle/meta/0001_snapshot.json`
  - `apps/api/drizzle/meta/_journal.json`
- A fresh dev database recently hit migration drift (`contact_tags` already
  existed while Drizzle still attempted to apply a migration), which is
  consistent with a development-only migration history reset request.
- There is unrelated active frontend work in `FIX-007/PLAN-029`; this plan must
  not revert or reformat those files.

## Proposal

After approval:

1. Stop the dev server in `bithk-dd24e5` and clear only this app's `bit`
   `nsl` routes if needed.
2. Delete the generated Drizzle migration directory contents under
   `apps/api/drizzle/`, including SQL files and `meta/*.json`.
3. Run the existing generator: `bun run --filter @app/api db:generate`.
4. Rebuild the local dev SQLite file without creating a backup so the new
   baseline can apply cleanly:
   `data/db/app.db`, `app.db-wal`, `app.db-shm`, and `app.pid`.
5. Start dev again with `bun run dev`.
6. Verify:
   - exactly one new generated baseline migration plus Drizzle meta files exist;
   - `http://bit.localhost:1355` returns `200 OK`;
   - `http://bit.localhost:1355/api/health/ready` returns `200 OK`;
   - optionally run `bun run --filter @app/api typecheck` if generation changes
     TypeScript-visible files.

## Risks

- This intentionally breaks compatibility with any database that already
  applied the old migration history.
- Drizzle may generate a different SQL file name; that is expected.
- If the current TypeScript schema has unresolved drift or duplicate table
  definitions, generation will fail and the old migration files should remain
  deleted only if the failure is immediately fixed or the user confirms.
- Active unrelated docs/frontend changes must be preserved.

## Scope

In scope:

- Generated files under `apps/api/drizzle/`.
- Local dev database reset required to validate the new baseline.
- PMA task/plan status updates.

Out of scope:

- Editing TypeScript schema definitions.
- Hand-writing SQL migrations.
- Production migration compatibility.
- Cleaning upload files, `meta.db`, or unrelated database backups.

## Alternatives

- Forward-fix with a new migration: safer for shared environments, but rejected
  for this request because the project is in development and the user asked to
  delete old schema/migration history.
- Keep old snapshots and only regenerate: likely preserves the drift problem,
  so it does not meet the reset goal.

## Annotations

- 2026-05-28 22:45 - Investigation and proposal recorded. Awaiting explicit
  approval before deleting generated migration files.
