# Audit Lane 04 — Data Integrity / Error Handling

Counts: P0 0 · P1 1 · P2 2 · P3 5

Scope: project module backend (`apps/api/src/modules/project/*`), shared tag
module (`apps/api/src/modules/tag/*`), the issue / procurement / item / document
/ contact services insofar as they share `tags_refs` and project-scoped
cascades, plus the project-detail frontend (`apps/web/.../projects/*`). Focus:
`tags_refs` (no `resource_id` FK) app-level cleanup, soft- vs hard-delete
semantics & orphans, transaction usage, error propagation, optimistic-update
consistency, and cascade behavior on project delete / archive.

Method: read each service end-to-end and traced every delete / cascade path and
multi-step write. Confirmed the global error boundary
(`shared/middleware/error-handler.ts`) and the absence of any user/project
hard-delete route.

---

## F1 — Contact hard-delete cleans `tags_refs` outside any transaction (non-atomic)
- Severity: **P1 high**
- Location: `apps/api/src/modules/contact/contact.service.ts:218-233` (esp. `224-232`); helper `apps/api/src/modules/tag/tag.service.ts:187-189`
- Description: `deleteContact` performs four independent `await`s with no enclosing
  transaction:
  1. `db.delete(contacts)` (the row),
  2. `deleteResourceTags(db, id)` → `delete tags_refs where resource_id = id`,
  3. `deleteTuplesForEntity(db, "contact", id)`,
  4. `deleteContactShares(db, id)`.
  Contact is the **only** hard-deleted tag-carrying resource, so this is the one
  place where the app-level `tags_refs` cleanup that compensates for the missing
  `resource_id` FK actually runs. Because steps 2–4 are not atomic with step 1,
  any throw / connection drop / process exit between them leaves the contact row
  gone but its `tags_refs`, Zanzibar relation tuples, and `shares` rows
  orphaned. Since `tags_refs.resource_id` has no FK and no `type` column, those
  orphan rows are never reachable for cleanup again.
- Impact: Permanent orphan `tags_refs` / tuple / share rows on partial failure.
  Orphan `tags_refs` rows inflate the type-wide `usageCount` correlated
  subquery (`tag.service.ts:240`, `listTagsWithUsage:62-71`), skewing the
  contact tag filter's "most-used" ordering and counts. Orphan tuples can leak
  residual access semantics if a future contact reuses the id space.
- Recommended fix: Wrap the row delete and the three cleanups in a single
  `db.transaction(...)` so they commit or roll back together. The tuple/share/tag
  deletes are local `tags_refs`/`relation_tuples`/`shares` writes and can run
  synchronously inside the tx (mirroring `softDeleteItem`'s inlined tuple
  cleanup at `item.service.ts:173-196`). Do the existence check and the
  `changes === 0 → NotFoundError` inside or before the tx.

---

## F2 — Project soft-delete does not cascade; child rows stay live & unreachable forever
- Severity: **P2 medium**
- Location: `apps/api/src/modules/project/project.service.ts:429-438` (`softDeleteProject`); reads at `:321-326` (`resolveProjectId`), `:309-313` (`getProjectByShortId`)
- Description: `softDeleteProject` only stamps `deleted_at` on the `projects`
  row. It does not touch the project's members, roles, procurement categories,
  cover reference, `tags_refs`, or its issue / procurement `items`. Issue and
  procurement rows keep `items.deleted_at IS NULL` (still "live"); their
  `issue_details.project_id` / `procurement_details.project_id` FKs are
  `ON DELETE CASCADE` but cascade only fires on a **hard** delete, which never
  happens here. There is no project hard-delete and no purge job
  (`cron/actions/soft-delete-cleanup/executor.ts` only purges `cron_jobs`), and
  no project restore endpoint, so a soft-deleted project's entire subtree is
  retained indefinitely.
- Impact: Unbounded accumulation of live-but-orphaned issue/procurement items,
  members, roles, categories and `tags_refs` for every "deleted" project. The
  items are normally unreachable because list/detail reads resolve the project
  first via `resolveProjectId` (which filters `deleted_at IS NULL`), but any
  query that reaches `items` by id/short-id without re-checking the parent
  project's `deleted_at` (e.g. policy/Zanzibar object lookups, future global
  search, the `idx_items_pinned` pin sweep) can still surface them. Tag usage
  counts continue to include the dead project's `tags_refs`.
- Recommended fix: Decide and document the intended semantics. Either (a) within
  `softDeleteProject`'s scope, soft-delete the cascade (stamp `deleted_at` on the
  project's issue/procurement items and tear down their relation tuples, mirroring
  `softDeleteItem`), or (b) add a retention/janitor action (like the cron
  soft-delete-cleanup) that hard-deletes long-soft-deleted projects **and** calls
  `deleteResourceTags` for each (since the project hard-delete would not clean
  `tags_refs`). At minimum, ensure every `items` read path that can return an
  issue/procurement also excludes rows whose parent project is soft-deleted.

---

## F3 — Latent: project/item hard-delete cascade bypasses `tags_refs` app-cleanup
- Severity: **P2 medium** (latent; currently un-triggerable)
- Location: `apps/api/src/modules/project/schema.ts:48` (`creatorId … onDelete: "cascade"`), `:66`, `:82`, `:113`; `apps/api/src/modules/item/schema.ts:20` (`items.creatorId … onDelete: "cascade"`); `apps/api/src/modules/issue/schema.ts:34` & `apps/api/src/modules/procurement/schema.ts:30` (`project_id … onDelete: "cascade"`); tag join `apps/api/src/modules/tag/schema.ts:25-31`
- Description: `projects.creator_id` and `items.creator_id` both declare
  `ON DELETE CASCADE` to `users.id`. If a user is ever hard-deleted, the DB would
  hard-delete every project and item they created. That DB-level cascade reaches
  `project_roles`, `project_members`, `procurement_categories`, and the
  issue/procurement `*_details` rows (all `project_id ON DELETE CASCADE`), but it
  **cannot** reach `tags_refs` (its `resource_id` has no FK) — only the app-level
  `deleteResourceTags` does, and nothing calls it on the project/item path. It
  would also delete an item's `*_details` while leaving foreign-creator `items`
  rows in other projects in an inconsistent state. Today this is inert: the user
  module only toggles `status` to `"disabled"` (`users.routes.ts` schema
  `:27,:35`, action `user.disabled` `:368`); there is no `delete(users)` anywhere.
- Impact: Latent. The moment a user hard-delete is introduced, deleting a user
  silently hard-purges their projects/items and orphans the corresponding
  `tags_refs` rows (no FK, never cleaned), permanently skewing tag usage counts —
  a data-loss + orphan footgun that the schema invites but the app never guards.
- Recommended fix: Make the latent contract explicit. Prefer changing
  `creator_id` cascades to `ON DELETE RESTRICT` / `SET NULL` (a user should not
  silently erase shared project data), and route any real account deletion
  through a service that explicitly soft-deletes or reassigns owned projects and
  calls `deleteResourceTags` per resource. If the cascade is intended, add a
  `tags_refs` cleanup trigger or a documented reconciliation sweep.

---

## F4 — Cover-image reference release is not atomic with the project update
- Severity: **P3 low**
- Location: `apps/api/src/modules/project/project.service.ts:466-477` (`setProjectCover`), `:492-500` (`removeProjectCover`); analogous default-cover paths `:534-555`, `:561-566`
- Description: Both helpers update `projects.cover_reference_id` and then call
  `releaseReference(...)` for the previous reference in a separate `await`, with
  no transaction (the inline comment at `:440-445` explains the
  repoint-before-release ordering is deliberate because the SQLite
  `ADD COLUMN` FK can't carry `ON DELETE SET NULL`). A crash/throw between the
  `update` and the `releaseReference` leaves the previous file reference
  unreleased — an orphaned `file_references` row / blob that the GC sweep never
  reclaims.
- Impact: Storage leak on partial failure; no correctness/visibility bug (the
  project already points at the new reference). Bounded to one stale reference
  per interrupted cover change.
- Recommended fix: Where the file layer allows, perform the repoint and the
  release within one transaction, or make `releaseReference` idempotent and add a
  periodic orphan-reference sweep so an interrupted release is eventually
  reconciled. Acceptable to leave as-is in dev if documented.

---

## F5 — Project update bumps `version` but enforces no optimistic-concurrency check
- Severity: **P3 low**
- Location: `apps/api/src/modules/project/project.service.ts:403-422` (`updateProject`); view exposes `version` at `:67-78`, `:104`; route `apps/api/src/modules/project/project.routes.ts:282-291`; contrast `apps/api/src/modules/item/item.service.ts:148-154` (`expectedVersion` guard)
- Description: `updateProject` increments `version` (`sql\`version + 1\``) and the
  `ProjectView` surfaces `version`, but the PATCH route and service accept no
  `expectedVersion` and never compare it. Items implement exactly this guard
  (`item.service.ts:148-154` scopes the update on `version = expectedVersion`),
  so the project path is inconsistent with the rest of the system.
- Impact: Two managers editing the same project concurrently silently
  last-write-wins (lost update). The exposed `version` is effectively
  decorative for projects. Low severity given the small editor set and the
  single settings dialog.
- Recommended fix: Either accept an optional `expectedVersion` in
  `UpdateProjectInput` and scope the `tx.update` `WHERE` on it (returning
  `undefined`/409 on mismatch, mirroring items), or drop `version` from the
  project write/response to avoid implying concurrency safety that isn't there.

---

## F6 — `deleteRole` "guest missing" fallback would FK-fail instead of degrading gracefully
- Severity: **P3 low** (edge; Guest is always seeded)
- Location: `apps/api/src/modules/project/project.roles.ts:209-228`; FK `apps/api/src/modules/project/schema.ts:85` (`role_id … onDelete: "restrict"`)
- Description: `deleteRole` reassigns every holder to the project's Guest role,
  then deletes the role, in one transaction. The comment at `:217` claims a
  fallback "if somehow missing, fallback: just delete the role." But
  `project_members.role_id` is `ON DELETE RESTRICT`; if Guest is absent and any
  member still holds the role, `tx.delete(projectRoles)` raises a FOREIGN KEY
  constraint, the transaction rolls back, and the request surfaces as a generic
  409 CONFLICT via the error handler's FK branch
  (`error-handler.ts:24-32`) — not the "just delete" the comment promises.
- Impact: Misleading comment; no data corruption (the RESTRICT FK protects
  integrity, and the error boundary returns a clean 409 rather than a 500). Only
  reachable if the seeded/backfilled Guest role is somehow gone — practically
  never (`seedDefaultRoles:71-130`, backfill `:290-305`).
- Recommended fix: Correct the comment, and if a true fallback is desired, fetch
  members first and block the delete with an explicit `ValidationError` when no
  Guest role exists, rather than relying on a delete that cannot succeed.

---

## F7 — `createProject` default-cover existence check is TOCTOU vs. the insert FK
- Severity: **P3 low**
- Location: `apps/api/src/modules/project/project.service.ts:281-307` (`resolveDefaultCoverReferenceId` + `createProject`)
- Description: `resolveDefaultCoverReferenceId` reads the
  `project.defaults.coverReferenceId` setting and verifies the referenced
  `file_references` row still exists, then returns it to be inserted as
  `cover_reference_id` in the **subsequent** synchronous `db.transaction`. The
  check and the insert are not atomic; if the admin removes the default cover in
  that window, the insert's `cover_reference_id` FK rejects and the whole project
  creation throws (surfaced as a 409 by the FK branch of the error handler).
- Impact: Rare, transient project-create failure under concurrent default-cover
  removal; no orphan or corruption. Self-correcting on retry.
- Recommended fix: Tolerate the race — catch the FK violation on insert and
  retry with `cover_reference_id = null`, or re-read the reference inside the tx.
  Low priority.

---

## F8 — `tags_refs` is polymorphic with no `type` column; relies on id-space disjointness
- Severity: **P3 low (nit)**
- Location: `apps/api/src/modules/tag/schema.ts:19-31`; assignment helpers `tag.service.ts:161-179`, `227-316`
- Description: `tags_refs(resource_id, tag_id)` carries no domain/type
  discriminator on `resource_id`; correctness depends entirely on (a) `tag_id`
  being globally unique and type-scoped via `tags.type`, and (b) `resource_id`
  values never colliding across domains. Resource ids come from different
  generators — projects use `ulid()` (`project.service.ts:230`), contacts/roles
  use `nanoid()`, items use `ulid()`. There is no DB-level guarantee these
  never collide, and a join is only kept unambiguous by that convention.
- Impact: Practically impossible collision (distinct alphabets/lengths), but the
  schema offers no guard; a future id-scheme change could silently mislink tags
  across domains. Also means a `tags_refs` row can't be attributed to a domain
  without joining `tags.type`, complicating any orphan-reconciliation sweep
  (see F1/F2/F3).
- Recommended fix: Optionally add a `resource_type` column to `tags_refs`
  (mirroring `tags.type`) so assignments are self-describing and an orphan sweep
  can target one domain safely; or document the id-disjointness invariant
  explicitly. Not required for current correctness.

---

## Areas checked and found clean

- **Frontend error handling / optimistic consistency** — `projects/*` mutations
  use TanStack Query with `onError` → `toast.error(errorMessage(...))` or local
  `setError` consistently (`index.lazy.tsx:81`, `-project-settings-*.tsx`,
  `-project-issue-panel.tsx:152,178,188`, `-project-procurement-panel.tsx:156,182,190`,
  `-project-cover-field.tsx:29-39`, pin toggles `-project-issues-tab.tsx:486-487`,
  `-project-procurement-tab.tsx:343-344`). No `onMutate`/optimistic cache writes
  are used, so there is no optimistic-vs-server divergence or missing-rollback
  risk; success handlers `setQueryData` + `invalidateQueries`
  (`-project-issue-hooks.ts:55-74`). No swallowed errors / empty catches found.
- **Server error boundary** — `shared/middleware/error-handler.ts` maps
  `AppError` → its status, `ZodError` → 422, `SQLITE_CONSTRAINT*` / UNIQUE /
  CHECK / FOREIGN KEY / NOT NULL violations → 409, and logs + 500 on the
  fallthrough. Service-layer throws (`NotFoundError`, `ValidationError`,
  `ForbiddenError`) propagate cleanly to it; no boundary swallows them.
- **Project create/update transactions** — `createProjectTx` and `updateProject`
  correctly wrap the multi-table writes (project row + roles + member +
  categories + tags) in one `db.transaction` (`project.service.ts:229-274`,
  `:416-420`); bun:sqlite sync-callback semantics are respected (comment `:292-294`).
- **Item / issue / document soft-delete** — `softDeleteItem`/`softDeleteIssue`/
  `softDeleteDocument` inline relation-tuple cleanup inside the same transaction
  as the `deleted_at` stamp (`item.service.ts:173-196`, `issue.service.ts:333-350`,
  `document.service.ts:330-355`), and intentionally retain `tags_refs` (the row
  still exists) — consistent with the documented soft-delete contract
  (`tag.service.ts:181-189`). Hard delete is intentionally not exposed
  (`item.service.ts:170-172`).
- **Tag delete cascade** — `deleteTag` relies on `tags_refs.tag_id ON DELETE
  CASCADE` (`tag/schema.ts:27`) so removing a tag unlinks every assignment
  atomically at the DB level (`tag.service.ts:117-128`); no app-level sweep
  needed on that side.
