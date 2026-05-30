# REFACTOR-005 Consolidate the tag abstraction

- Status: Done
- Plan: [PLAN-031](../plan/PLAN-031.md)
- Owner: BKD L2 (campaign l1-lsqiuvv9-20260528224534)
- Updated: 2026-05-28

## Goal

Complete the tag abstraction started in [FEAT-015](FEAT-015.md) so the tag
module owns the tag vocabulary, source-type validation, common create/rename/
delete/list APIs, the `/tags` routes, and reusable assignment helpers. Project,
contact, and document modules should only supply their resource-specific join
table and resource id and call tag-module helpers, instead of duplicating tag
normalization/upsert/sync/load/filter logic.

## Scope

In scope:

- `apps/api/src/modules/tag/*` - shared assignment helpers, a tag-source
  registry, and the relocated `/tags` routes plus tests.
- `apps/api/src/modules/project/*` tag-related service/route/test code only.
- `apps/api/src/modules/contact/*` tag-related service/test code only.
- `apps/api/src/modules/document/*` tag-related service/schema/test code only,
  including removal of the legacy `document_details.tags` JSON column.
- Backup contribution ordering if affected.
- Frontend API clients/tests only if endpoint ownership or response shape
  changes (expected: none - `/tags` path and payloads are preserved).
- `docs/task`, `docs/plan`, `docs/modules`, `docs/reference`, `docs/changelog`
  updates for this task.

Out of scope: unrelated UI redesign, unrelated project/contact/document domain
changes, dependency upgrades, auth/policy redesign, broad database normalization
beyond tags, and hand-authored migrations.

## Acceptance

- The tag module owns the tag vocabulary schema, source-type validation, the
  common create/rename/delete/list APIs, the `/tags` routes, and reusable
  assignment helpers for syncing/listing/filtering resource tags.
- Project, contact, and document services stop duplicating tag normalization/
  upsert/sync/load/filter patterns where a shared helper is straightforward.
- Document tag storage has a single authoritative path: the legacy
  `document_details.tags` column is removed from the Drizzle schema (migration
  regeneration coordinated with [CHORE-002](CHORE-002.md)).
- `/tags` route ownership is moved into the tag module behind a source registry,
  so the tag module does not import domain schemas. Endpoint paths and payloads
  stay compatible.
- Source types remain type-scoped: the same name can exist independently across
  project/contact/document; duplicates within one type are rejected.
- Backup/restore ordering keeps `tags` before all join tables.
- Tests cover the shared assignment helpers plus affected project/contact/
  document behavior.
- English docs/references describe one tag abstraction module with no stale
  project-owned or document-JSON tag model.
- Focused backend tests and, if feasible, `bun run check` pass; pre-existing
  unrelated failures are reported precisely.

## Notes

- 2026-05-28 22:50 - Investigation by BKD L2 for campaign
  `l1-lsqiuvv9-20260528224534`. FEAT-015 introduced typed tags but left each
  domain owning duplicate sync/load/filter code, the `/tags` routes living in
  the project module, and the legacy `document_details.tags` JSON column.
- 2026-05-28 - Implemented via L3-A/B1/B2/B3/D/E (all merged to main): tag
  module now owns the vocabulary, source-type validation, create/rename/delete/
  list APIs, the `/tags` routes (behind a `registerTagSource` registry so the
  tag module imports no domain schema), and reusable assignment helpers
  (`syncResourceTagsTx`, `listResourceTagViews`/`Names`, `loadResourceTagsByResource`,
  `resolveTagIdByIdOrName`, `listResourceIdsByTag`). project/contact/document
  services migrated to those helpers; the legacy `document_details.tags` column
  was removed from the Drizzle schema (migration regeneration deferred to
  CHORE-002 baseline rebuild - TS schema changed only, no `db:generate`). Docs
  aligned (new docs/modules/tag.md; project/contact/document module docs,
  database.md, changelog). gen-api-docs generator updated to mount `tagRoutes()`.
  `bun run check` passes (lint/typecheck/test/build/i18n/env-docs/api-docs);
  backend tag/project/contact/document tests green.
