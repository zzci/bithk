# PLAN-031 Tag abstraction consolidation

- **status**: completed
- **createdAt**: 2026-05-28 22:50
- **approvedAt**: 2026-05-28 22:50 (L1 dispatch grants in-scope auto-approval)
- **relatedTask**: REFACTOR-005

## Context

[FEAT-015](../task/FEAT-015.md) / [PLAN-023](PLAN-023.md) introduced a central,
type-scoped `tags` table (`source_type` in project/contact/document) and a
`tag.service` with `normalizeTagName`, `assertValidTagName`, `upsertTagIdTx`,
`listTagsWithUsage`, `createTag`, `renameTag`, `deleteTag`. It did not finish the
abstraction:

- `apps/api/src/modules/project/project.service.ts` owns `syncTagsTx`,
  `loadTagsByProject`/`loadTagsForProject`, and `tagId` list filtering.
- `apps/api/src/modules/contact/contact.service.ts` owns its own `syncTagsTx`,
  `loadTagsForContact`, and `resolveTagId` (id-or-name) plus tag filtering.
- `apps/api/src/modules/document/document.service.ts` owns `syncDocumentTagsTx`,
  `loadDocumentTagNames`, tag filtering, plus a `listAllTags` cache.
  These are three near-identical delete-upsert-reinsert / inner-join-load
  implementations.
- `/tags` (GET list, POST/PATCH/DELETE admin) lives in
  `apps/api/src/modules/project/project.routes.ts` and imports `contactTags` and
  `documentTags` to serve all three types via a local `TAG_JOINS` map. This puts
  cross-domain route ownership in the project module and imports domain schemas.
- `apps/api/src/modules/document/schema.ts` still declares
  `document_details.tags text NOT NULL DEFAULT '[]'`. The service comments mark
  it legacy; `document_tags` join rows are authoritative.
- Stale docs: `docs/modules/project.md` (tags project-owned/global-unique),
  `docs/modules/document.md` (document_details.tags as the tag store),
  `docs/reference/database.md` (tags JSON under document_details).
- Routes are mounted in `apps/api/src/routes/protected.ts`; `/tags` is gated by
  `authRequired` + `adminRequired` middleware, not by a policy `defineResource`,
  so relocation needs no policy-binding migration.
- An active [CHORE-002](../task/CHORE-002.md) / [PLAN-030](PLAN-030.md) rebuilds
  the Drizzle migration baseline by deleting `apps/api/drizzle/*` and
  regenerating one baseline from the current TypeScript schema.

Breaking changes are acceptable (R&D); backward compatibility is not required.

## Migration-conflict assessment

Removing `document_details.tags` is a Drizzle schema change. CHORE-002/PLAN-030
owns the migration baseline and will regenerate it from the current TS schema.
To avoid conflicting migration work:

- This plan changes only the TypeScript schema and service/test code; it does
  **not** run `db:generate` and does **not** edit files under
  `apps/api/drizzle/`.
- The dropped column is `NOT NULL DEFAULT '[]'`, so an old migration that still
  creates it leaves a harmless unused column; inserts omit it and reads never
  reference it. Backend tests therefore pass without immediate regeneration.
- L2 escalates to L1 to sequence CHORE-002 baseline regeneration after this
  merges so the rebuilt baseline naturally drops the legacy column.

## Proposal

1. Tag module foundation (tag module owns the abstraction).
   - Add a reusable `ResourceTagBinding` (`sourceType`, join `table`,
     `resourceColumn`, `tagColumn`) and helpers in `tag.service.ts`:
     `syncResourceTagsTx`, `listResourceTagViews`, `loadResourceTagsByResource`
     (grouped), `resolveTagIdByIdOrName`, and a tag-filter helper that returns
     resource ids for a `tagId`/name.
   - Add a `tag.registry.ts` source registry (`registerTagSource`,
     `getTagBinding`) mirroring the existing backup/permission-hook registry
     pattern, so `/tags` can serve all types without the tag module importing
     domain schemas.
   - Move `/tags` (GET list + admin POST/PATCH/DELETE) into a new
     `tag.routes.ts`, driven by the registry; register `tagRoutes()` in
     `protected.ts` and keep the existing `authRequired` + `adminRequired`
     gating and `type` query/body semantics (default `project`).
   - Each domain registers its binding at module load (index.ts side-effect),
     mirroring backup contributions, keeping the dependency direction one-way.

2. Migrate consumers onto the helpers.
   - `project.service.ts`: replace `syncTagsTx`/`loadTags*`/`tagId` filtering and
     drop the now-dead local tag CRUD wrappers; use tag-module helpers.
   - `contact.service.ts`: replace `syncTagsTx`/`loadTagsForContact`/
     `resolveTagId`/tag filtering with helpers.
   - `document.service.ts`: replace `syncDocumentTagsTx`/`loadDocumentTagNames`/
     tag filtering with helpers; keep the `listAllTags` cache behavior.

3. Legacy document tag storage cleanup.
   - Remove `document_details.tags` from `document/schema.ts` and any remaining
     reads/writes. Migration regeneration deferred to CHORE-002 (see above).

4. Docs/changelog.
   - Update `docs/modules/project.md`, `docs/modules/document.md`,
     `docs/reference/database.md`, any `docs/reference/api*.md` if needed, and
     `docs/changelog.md` to describe one tag abstraction module.

5. Verification.
   - Focused backend tests for tag/project/contact/document, then `bun run
     check` if feasible.

## Risks

- Relocating `/tags` could change effective gating if done carelessly - keep the
  same middleware and verify route tests move with the routes.
- Generic helpers must keep type-scoped uniqueness and per-resource join
  semantics identical; cover with helper unit tests.
- Removing the legacy column without immediate regeneration relies on CHORE-002
  ordering; documented and escalated.

## Scope

In scope: tag module helpers/registry/routes/tests; project/contact/document tag
service/route/schema/test code; backup ordering if affected; docs/changelog.

Out of scope: auth/policy redesign, unrelated schema cleanup, dependency
upgrades, broad UI redesign, hand-authored migrations, and running CHORE-002's
baseline regeneration.

## L3 Decomposition (DAG)

- **L3-A** (worktree, deps none) - Tag module foundation: assignment helpers +
  `ResourceTagBinding`, `tag.registry.ts`, relocated `tag.routes.ts`, register
  `tagRoutes()` in `protected.ts`, register the three domain bindings in each
  domain `index.ts` (side-effect only), remove the `/tags` block + `TAG_JOINS`
  from `project.routes.ts`, relocate `/tags` route tests, and add helper/registry
  tests.
- **L3-B1** (worktree, deps [A]) - Migrate `project.service.ts` (+ test) onto the
  helpers; drop dead local tag CRUD wrappers.
- **L3-B2** (worktree, deps [A]) - Migrate `contact.service.ts` (+ test) onto the
  helpers.
- **L3-B3** (worktree, deps [A]) - Migrate `document.service.ts` (+ test) onto the
  helpers and remove the legacy `document_details.tags` column from
  `document/schema.ts`.
- **L3-D** (simple, deps [A,B1,B2,B3]) - Docs/changelog alignment and final
  `bun run check` verification; integration fixes only within this plan.

B1/B2/B3 touch disjoint files (separate module service/schema/tests) and run in
parallel after A. A owns each domain `index.ts` and `project.routes.ts`; B owns
each domain's service/schema/tests - no file-write overlap.

## Verification Plan

- Helpers/routes: `bun --cwd apps/api --env-file=/dev/null test
  src/modules/tag/`
- Consumers: `bun --cwd apps/api --env-file=/dev/null test
  src/modules/project/ src/modules/contact/ src/modules/document/`
- Final gate: `bun run check`

## Alternatives

- Polymorphic `tag_assignments(resource_type, resource_id, tag_id)` replacing
  the three join tables. Rejected (consistent with PLAN-023): weakens type-safe
  module queries and SQLite FK behavior for no immediate gain.
- Keep `/tags` in the project module. Rejected: leaves cross-domain route
  ownership and domain-schema imports in project, contradicting the abstraction
  goal.
- Tag module imports domain join schemas directly for routes. Rejected: inverts
  the one-way dependency; the registry keeps it clean.

## Annotations

- 2026-05-28 22:50 - Investigation and proposal recorded by BKD L2 for campaign
  `l1-lsqiuvv9-20260528224534`. In-scope auto-approval per L1 dispatch.
- 2026-05-28 - Completed. DAG executed as planned: L3-A foundation
  (191c378) -> L3-B1 project (3263298) / L3-B2 contact (89311c9) / L3-B3 document
  + legacy-column removal (fda01e4) -> L3-D docs (03158ac). One extra subtask
  L3-E (79664d0) fixed the api-docs generator to mount the relocated
  `tagRoutes()` (a consequence of moving `/tags`). All merged to main with
  per-merge ancestry checks under the L1 shared-tree serialization rule.
  `bun run check` green. Migration regeneration for the dropped
  `document_details.tags` column is deferred to CHORE-002 per coordination.
