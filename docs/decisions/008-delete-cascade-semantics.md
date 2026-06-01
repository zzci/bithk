# 008 — Project delete cascade semantics & `tags_refs` cleanup contract

- Status: accepted
- Date: 2026-06-01
- Review by: 2026-12-01
- Scope: the project module's delete paths (`apps/api/src/modules/project/project.service.ts`,
  `apps/api/src/modules/project/schema.ts`) and the base-item creator FK
  (`apps/api/src/modules/item/schema.ts`), insofar as they interact with the
  shared, FK-less `tags_refs` join.
- Related: campaign l1-75ymcfnr-projaudit (audit lane 04 — data integrity),
  findings 04-F2 and 04-F3.

## Context

`tags_refs(resource_id, tag_id)` is the shared tag-assignment join. Its
`resource_id` carries **no foreign key** (it is polymorphic across projects,
items, contacts, …) and **no `type` discriminator**. The practical
consequence: a database-level `ON DELETE CASCADE` can never reach `tags_refs`,
and once a parent row is gone its `tags_refs` rows are unreachable for cleanup
(nothing knows they belonged to that domain). Every hard-delete of a
tag-carrying resource must therefore drop its `tags_refs` rows at the
application level, inside the same transaction.

Two delete paths were under-specified:

- **04-F2 — project soft-delete did not cascade.** `softDeleteProject` only
  stamped `deleted_at` on the `projects` row. The project's issue / procurement
  `items` kept `deleted_at IS NULL` (still "live") and accumulated indefinitely
  under a project no list/detail read can reach. There is no project
  hard-delete, no purge job, and no restore endpoint.
- **04-F3 — `creator_id` cascade was a latent orphan/data-loss footgun.**
  `projects.creator_id` and `items.creator_id` both declared
  `ON DELETE CASCADE` to `users.id`. The app never hard-deletes a user today
  (account removal only toggles `status = "disabled"`), so the cascade was
  inert. But the moment a real user hard-delete is introduced, deleting a user
  would silently hard-purge every project/item they created — and that DB
  cascade cannot reach `tags_refs`, permanently orphaning the tag links and
  skewing the type-wide tag usage counts.

## Decision

### 04-F2 — project soft-delete cascades to child work items (one-way)

`softDeleteProject` now, **in a single transaction**:

1. stamps `deleted_at` on the `projects` row, and
2. soft-deletes every live issue / procurement `item` belonging to the project
   (resolved via the `issue_details` / `procurement_details` `project_id`
   link), stamping `deleted_at` and bumping `version`, and
3. tears down each child item's `relation_tuples` (object side), mirroring
   `softDeleteItem`.

If the project is already soft-deleted (the guarded `UPDATE` affects 0 rows),
the cascade is skipped so a repeated call never re-stamps children.

Members, roles, procurement categories, the cover reference, and the project's
own `tags_refs` are **intentionally retained** — the `projects` row still
exists, so those rows are still attributable and reachable. There is no project
restore endpoint, so this cascade is **one-way by design**: a re-activation
feature, if ever added, must explicitly re-stamp / re-tuple the children rather
than assume the soft-delete was reversible.

### 04-F3 — `creator_id` is `ON DELETE RESTRICT`, not `CASCADE`

`projects.creator_id` and `items.creator_id` are changed from
`ON DELETE CASCADE` to `ON DELETE RESTRICT` (migration `0001_hot_whistler`).
A user can no longer be hard-deleted while they own any project or item; the
delete fails fast at the FK instead of silently erasing shared project data and
orphaning `tags_refs`. Any real account-deletion feature must route through a
service that first reassigns or soft-deletes the owned projects/items and calls
`deleteResourceTags` per resource — making the `tags_refs` cleanup obligation
explicit at the one place that can satisfy it.

The contact hard-delete path (the only resource the app hard-deletes today)
already drops `tags_refs` app-level; as of this campaign it does so inside one
transaction with the row, tuple, and share cleanups (04-F1), so a mid-cleanup
failure can no longer orphan rows.

## Rationale

- **No unbounded live-but-orphaned subtree.** Cascading the soft-delete keeps a
  "deleted" project's children consistently invisible and tuple-clean, instead
  of leaving live items that a future global search / pin sweep / policy lookup
  could surface.
- **The FK-less join dictates app-level cleanup.** Because `tags_refs` can't be
  reached by any DB cascade, the only safe contract is: never let a cascade
  silently delete a tag-carrying resource. `RESTRICT` enforces that for the
  creator path; explicit service code enforces it for contacts.
- **Fail fast over silent data loss.** A blocked user-delete is a loud,
  recoverable error; a cascading hard-purge of shared projects is silent and
  irreversible.

## Alternatives considered

- **04-F2: add a retention/janitor that hard-deletes long-soft-deleted projects
  and calls `deleteResourceTags` per resource.** Rejected for now: heavier
  (needs a cron action, a retention window, and a project hard-delete path that
  does not exist), and it does not stop the children from being live in the
  meantime. The in-transaction cascade is the minimal correct fix; a janitor can
  be layered on later without contradicting this decision.
- **04-F3: keep `CASCADE` but add a `tags_refs` reconciliation sweep.** Rejected:
  SQLite has no post-cascade hook, so the sweep would have to scan for orphans
  blindly (no `type` column to target a domain) and would still allow silent
  bulk data loss. `RESTRICT` removes the footgun outright.
- **04-F3: `SET NULL` on `creator_id`.** Not possible — `creator_id` is
  `NOT NULL`.

## Deferred (documented, not implemented this campaign)

- **04-F4 — cover-image reference release is not atomic with the project
  update.** A crash between the `projects.cover_reference_id` repoint and the
  `releaseReference` of the previous reference leaks one unreleased
  `file_references` row (storage only; the project already points at the new
  reference). A fully atomic fix needs a transaction-aware reference-release API
  in the file module (`file.service.ts`), which is outside this campaign's file
  ownership; inlining the release would either duplicate file-layer internals or
  regress sync-mode blob GC. The existing repoint-before-release ordering bounds
  the leak to one reference per interrupted change. Deferred to a file-module
  change.
- **04-F5 — `updateProject` bumps `version` without an optimistic-concurrency
  guard.** Adding an `expectedVersion` check would also require route-layer
  changes (`project.routes.ts`), which are out of this campaign's scope; with the
  small editor set and single settings dialog the lost-update risk is low.
  Deferred.

## Sunset / review

Revisit by **2026-12-01**. This is a dev-phase decision: breaking changes are
acceptable and the DB may be reset freely, so the migration carries no
backfill. If a `tags_refs.resource_type` discriminator is added later (04-F8),
re-evaluate whether a targeted orphan-reconciliation sweep makes a softer
`creator_id` policy viable, and supersede this decision rather than reverting
the FK by accident.
