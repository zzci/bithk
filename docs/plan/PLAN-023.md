# PLAN-023 Global typed tags model

- **status**: completed
- **createdAt**: 2026-05-28 14:55
- **approvedAt**: 2026-05-28 15:00
- **relatedTask**: FEAT-015

## Context

Investigation covered backend schema, services, routes, backup contributions,
tests, frontend API hooks, fixtures, and API/module docs.

Current tag state:

- `apps/api/src/modules/project/schema.ts` defines `tags` with `id`, `name`,
  timestamps, and a unique index on `name`. There is no type/source
  discriminator, so all domains share one flat namespace.
- `project_tags` links projects to `tags`; project service owns tag CRUD,
  `/tags` routes, project tag sync, project filtering by `tagId`, and
  project tag `usageCount`.
- `contact_tags` links contacts to the same `tags` table by importing it from
  the project module. Contact service has its own duplicate tag upsert/sync and
  filters by tag id or name.
- Documents are separate: `document_details.tags` stores a JSON string array.
  Document list filtering uses a SQLite `LIKE` pattern against that JSON, and
  `/documents/tags` derives distinct values through `json_each`.
- Frontend consumers:
  - `apps/web/src/shared/lib/api/projects.ts` reads `/tags` as project tags.
  - `apps/web/src/shared/lib/api/tag-admin.ts` mutates `/tags`.
  - `apps/web/src/shared/lib/api/documents.ts` reads `/documents/tags` as
    `readonly string[]` and parses document row tags from JSON.
  - Contact UI sends free-form tag names and filters by a text query.
- Relevant tests include project/contact/document service and route tests,
  frontend API hook tests, route component tests, fixtures under `tests/`, and
  smoke/e2e request handlers that mock `/tags`.
- Migration tooling is Drizzle Kit through `bun run --filter @app/api
  db:generate`. Migration output must not be hand-authored.

Breaking-change tolerance is explicitly approved for this R&D repository. The
simplest useful model is to keep domain assignment tables, make the vocabulary
typed, and move document tags from JSON-only storage into a document join table.

## Proposal

1. Introduce a central tag module.
   - Move the `tags` schema export into a tag-owned module or otherwise make
     tag ownership explicit outside the project module.
   - Add a `sourceType`/`source_type` discriminator with an enum such as
     `project`, `contact`, and `document`.
   - Replace global unique `name` with type-scoped uniqueness
     `(source_type, name)`.
   - Keep current `id`, `name`, `createdAt`, and `updatedAt` conventions.

2. Keep simple per-domain assignment tables.
   - Keep `project_tags(project_id, tag_id)` and `contact_tags(contact_id,
     tag_id)`.
   - Add `document_tags(item_id, tag_id)` referencing `items.id` and `tags.id`.
   - Do not add a polymorphic assignment table yet; it would make current
     module queries less direct and add no immediate value.

3. Centralize common tag operations.
   - Add shared helpers for validating/normalizing names and upserting tags by
     `(sourceType, name)`.
   - Project/contact/document services can still own their join-table rewrites
     to keep transaction code obvious.
   - Project tag listing computes usage from `project_tags`; document tag
     listing computes distinct document tag names from `document_tags`.

4. Preserve endpoint shapes where cheap, but make type support explicit.
   - Keep `/tags` for project tag consumers, defaulting to project tags if no
     type query/body field is supplied.
   - Allow `/tags?type=project|contact|document` and admin create with a
     `type` field for unified maintenance.
   - Keep `/documents/tags` returning `readonly string[]` unless the document
     UI needs typed objects.
   - Document the breaking database/API semantics in module docs,
     `docs/reference/api-routes.md`, `docs/reference/api.md`, and
     `docs/changelog.md` if the final implementation changes payloads.

5. Generate and verify migration through Drizzle.
   - Change schema/model first.
   - Run `bun run --filter @app/api db:generate`.
   - Do not hand-edit generated SQL or snapshot output.

## Risks

- Existing data migration is breaking. This is acceptable in R&D, but the
  generated migration may drop/recreate tag-related structures rather than
  preserve every old JSON tag.
- Documents currently expose tags as JSON strings in row payloads. Changing
  that response shape would touch more frontend code. Prefer keeping the JSON
  string response while backing it from join rows unless implementation proves
  the typed array shape is simpler.
- `/tags` is already project-facing in the UI. Adding type support must avoid
  accidentally showing contact/document tags in the project filter.
- Backup/restore table ordering must be updated so `tags` precedes all join
  tables and `document_tags` follows `items` and `tags`.

## Scope

In scope:

- Tag schema ownership, typed `tags` table, assignment joins, services, routes,
  migration generation, backup contributions, focused tests, fixtures, frontend
  API hooks/types, and English docs/changelog updates.

Out of scope:

- Auth/permission redesign, unrelated schema cleanup, unrelated module rewrites,
  dependency upgrades, broad UI redesign, and manual migration authoring.

## L3 Decomposition

- L3-A Schema and migration: update Drizzle schema ownership, add typed tags and
  document assignment schema, generate migration, update backup ordering, and
  self-review.
- L3-B Backend services/routes/tests: refactor project, contact, and document
  tag code onto typed tags; update route/service tests and docs; self-review.
- L3-C Frontend consumers/fixtures/verification: update frontend API types/hooks
  and fixtures/mocks for typed tag semantics, run focused frontend checks, and
  self-review.
- L3-D Integration verification: after dependencies pass, run focused backend
  tests plus `bun run check`, resolve integration fallout only within this
  plan, and self-review.

Schema/migration work must complete before service/UI subtasks. Backend service
work must complete before integration verification. Frontend fixture work can
start after the API contract is known.

## Verification Plan

- Focused backend tests:
  - `bun --cwd apps/api --env-file=/dev/null test src/modules/project/project.routes.test.ts src/modules/project/project.service.test.ts src/modules/contact/contact.routes.test.ts src/modules/contact/contact.service.test.ts src/modules/document/document.test.ts`
- Focused frontend tests for changed API hooks/routes as needed:
  - `bun --cwd apps/web test src/shared/lib/api/projects.test.ts src/shared/lib/api/tag-admin.test.ts src/shared/lib/api/documents.test.ts src/shared/lib/api/contacts.test.ts`
- Migration generation:
  - `bun run --filter @app/api db:generate`
- Final quality gate:
  - `bun run check`

## Alternatives

- Use one polymorphic `tag_assignments` table with `resource_type` and
  `resource_id`. Rejected for now: it removes join-table duplication but makes
  type-safe module queries and FK behavior weaker in SQLite.
- Keep document tags as JSON and only add `source_type` to `tags`. Rejected:
  documents would remain a separate module-specific tag storage path, missing
  the central maintenance goal.
- Make `/tags` require an explicit type immediately. Rejected for now because
  defaulting to project tags keeps the existing project UI path narrow while
  still allowing typed maintenance.

## Annotations

- 2026-05-28 14:55 - Investigation and proposal prepared by BKD L2 g7amf4od for
  campaign `l1-cuu89zau-20260528145145`.
- 2026-05-28 15:00 - User prompt grants automatic approval after PMA
  investigation/proposal tracking. Plan moved directly to implementing for the
  approved scope.
- 2026-05-28 15:00 - L2 wake-up found L3-A (`tlt1d582`) still running with
  active schema/backup/migration logs. Backend, frontend, and final verification
  L3 issues remain `todo` until schema work is integrated.
- 2026-05-28 15:13 - L3-A passed scope review and was merged into main as
  `b28c701`. L3-B (`mrnbjdkw`) received the schema handoff and moved to
  `working`.
- 2026-05-28 15:15 - L3-B remains `working`. Logs show active investigation and
  the expected typecheck failures from old `tags` imports; no escalation needed.
- 2026-05-28 15:32 - L3-B has uncommitted backend changes in its isolated
  worktree and logs show `@app/api` typecheck, document tests, the full API test
  suite, and lint passing. L2 requested L3-B to finish self-review, commit,
  report, and leave the issue in `review` before integration.
- 2026-05-28 15:33 - L2 detected duplicate PMA doc creation starting in the
  L3-B worktree and sent a correction to remove those doc changes before
  committing. This is a yellow scope issue, not a technical blocker.
- 2026-05-28 15:40 - L3-B reported completion after passing backend checks but
  did not create a git commit. L2 committed only the scoped backend files from
  the L3-B worktree as `b27ae87`, left duplicate PMA docs out of the branch, and
  merged it into main as `1ee0e27`. Post-merge backend typecheck and focused
  tests passed.
- 2026-05-28 15:42 - L3-C (`akqv3x2b`) moved to `working` with the merged
  backend contract. It must avoid PMA doc duplication and focus on frontend API
  consumers, fixtures, mocks, and tests.
- 2026-05-28 15:45 - L3-C is still running. Logs show it has confirmed focused
  frontend API tests and `@app/web` typecheck pass, then continued checking
  root-level fixtures and smoke/e2e mocks for namespace correctness. No merge
  candidate exists yet.
- 2026-05-28 15:53 - L3-C completed with a green frontend audit. L2 committed
  the missing one-test diff as `fd95936` and merged it into main. L3-D can now
  run final verification and close out PMA tracking.
- 2026-05-28 15:54 - L3-D (`k32jix9y`) moved to `working` for final `bun run
  check` verification and directly related integration fixes only.
- 2026-05-28 15:59 - L3-D completed verification-only at campaign integration
  commit `affe9de`. `bun run check` exited 0: lint 0 errors, typecheck passed,
  tests passed, web build passed, and generated docs checks were up to date.
  No final integration fixes were required.
