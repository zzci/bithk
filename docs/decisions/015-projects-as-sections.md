# 015 — Projects are compositions of mounted sections; ships are a preset

- Status: Accepted
- Date: 2026-08-28
- Review by: 2027-02-28
- Scope: project core schema, the project section registry, section route
  gating, backup contribution grouping and archive format epoch
- Plan / task: [PLAN-108](../plan/PLAN-108.md) · [REFACTOR-039](../task/REFACTOR-039.md)
- Supersedes: [ADR-004 — Ship/project cycle handling in schema and backup restore](./004-ship-project-cycle-and-restore.md)

## Context

A ship was a separate module that, in practice, was "a project plus a maritime
profile, equipment and worklists". Every ship auto-created a **base project**
that carried its members, roles, files, work orders and procurement, and the
two rows pointed at each other (`ships.base_project_id` /
`projects.ship_id`). That cycle is what ADR-004 had to accommodate — in the
generated migration and in backup dependency resolution.

Duplicating the aggregate cost twice: two route trees, two nav modules, two
module-gate keys, two PAT scopes, two list/detail/settings UIs — and every
cross-cutting change (covers, tags, search, favorites, overview) had to be
implemented in both. Meanwhile the project module was accreting things that
were not project-core at all: procurement categories, and every future domain
would have landed there too.

Two shapes were available. Fold ships in as a project `type` enum and
hard-code "if `type = ship`, also show the maritime tabs" — smaller, but it
makes the project module the file every future domain must be patched into,
and the enum grows one value per combination. Or make the project a
composition.

## Decision

**A project is a core record plus a set of mounted sections.** There is no
project `type` column and no ship table: a project that has `ship-profile`
mounted *is* a ship.

- `projects` keeps identity and metadata, `parent_id` (one level of
  sub-projects) and its permission anchor (`project_roles` /
  `project_members`). `ship_id` is gone.
- `project_sections(project_id, key, sort_order, created_at)`, PK
  `(project_id, key)`, plus a key-first index `(key, project_id)`. A row
  present means the section is mounted; its absence means it is not. This
  table is the single source of truth for what a project is.
- A **section** is an independent sub-module owning its own tables, routes,
  capabilities, backup contribution and UI tab. It registers itself in
  `modules/project/section.registry.ts` from its OWNING module's barrel, as an
  import-time side effect ([ADR-009](./009-module-barrels.md)), so the project
  module never imports the modules it hosts.
- **Presets** are a static map, not a table: `general` mounts
  `issues + procurement + files`; `ship` mounts those plus `ship-profile +
  equipment + worklist`. "Ship" is a create-time preset, not a type.
- Capabilities stay ONE flat literal (`PROJECT_CAPABILITIES`) — roles validate
  their JSON array against it — with a sibling `CAPABILITY_SECTION` map tagging
  each entry with its owning section. The fold added **no** new capabilities.
  Capabilities that belong to every project are tagged `core`.

### The registry contract, and its deliberate limits

`ProjectSectionDefinition` has exactly four fields: `key`, optional
`capabilities`, optional `provision`, optional `hasData`. That is the whole
surface. The following are **binding non-goals**, not "not yet" — a change
request that needs one of them is a signal the design has drifted, and it must
come back through this ADR rather than be added quietly:

- **No runtime or dynamic section loading.** The registry is a static list
  populated by module barrels at import time. No plugin discovery, no
  marketplace.
- **No per-section config JSON.** The only data a mount carries is
  `(project_id, key, sort_order, created_at)`. There is no config column and no
  per-project section settings blob.
- **No section versioning.** A section is plain code; it has the one shape the
  build ships. There is no `version` column and no per-version migration path.
- **No per-section membership or roles.** Membership and roles are project
  core. A section narrows access through capabilities the project already
  grants, never through a membership list of its own.
- **No permission inheritance from parent to sub-project.** A child project
  keeps its own members, roles and sections; the link is navigational only.
- **No hierarchies deeper than one level.** A project with a parent cannot
  itself become a parent. Enforced in the service, not by the DB (the self-FK
  carries only `ON DELETE SET NULL`, so a hard-deleted parent unlinks its
  children instead of taking them with it).
- **No generic custom-field builders.** A new domain is a new module that
  registers a section, not a schema-in-a-column.

### Provision hooks are synchronous, by necessity

`provision(tx, projectId, ctx)` is the copy-on-mount hook (procurement copies
the global category template; `ship-profile` inserts the profile row;
`equipment` copies the global equipment-category template). Its declared return
type is `void | undefined`, not a bare `void`.

The reason is the runtime: **bun:sqlite transactions are synchronous.** A hook
that deferred a write past an `await` would run its statements *after* the
transaction had already committed — silently, with no error, leaving a mounted
section whose seeded rows are missing or unrolled-back. Spelling the return
type as a union is what makes an `async` hook a compile error (TypeScript lets
a function of any return type satisfy a `void`-returning signature, so a bare
`void` would have accepted one). `provisionSections` keeps the equivalent
runtime check — a returned `Promise` throws — as defence in depth.

Hooks run on **both** mount paths: the create-time preset, and a later
`mountSection`, which wraps the mount row and the hook in one transaction. A
project can therefore become a ship after creation, and the invariant "section
mounted" == "the rows it seeds exist" holds on both paths. A hook that throws
rolls the mount row back with it — there is no half-mounted state.

### `requireSection` is fail-closed

Section routes live in their owning modules and wrap themselves in
`requireSection(key)`. A missing project, a soft-deleted one and an unmounted
section all surface as the same 404, per
[ADR-003](./003-fail-closed-404-existence-policy.md): a caller cannot probe
which projects have which sections. Sections keep their own per-route
capability gates on top of the section gate.

Unmount is refused with `409 SECTION_NOT_EMPTY` while the section's `hasData`
predicate holds. There is no data loss on unmount and no soft "disabled" state:
a section is mounted, or it is not.

### The archive format epoch is a one-time reset

`BACKUP_FORMAT_VERSION` goes 2 -> 3. This is **not** an incremental format
change: the tar / manifest / NDJSON framing is byte-for-byte what 2 was. The
bump exists solely so the manifest's exact-match version gate refuses every
pre-fold archive, whose rows describe a schema that no longer exists.

The fold reset the schema outright — a re-squashed Drizzle baseline, no ALTER
chain, no backfill, no fold script. There is consequently nothing for a
pre-reset archive to be migrated *onto*, so the importer says so with an
actionable message instead of a bare version number: recovering data from a
pre-reset archive means running a **pre-reset build** of the server against a
copy of that deployment and reading it there.

**This is irreversible.** Every pre-fold database and every pre-fold archive is
unusable against this build. It was taken deliberately, under the standing
dev-phase rule that breaking changes and DB resets are acceptable.

### Backup contributions regroup; the cycle dies

- `project_sections` joins the `projects` contribution (it FKs `project_id`, so
  it trails `projects`).
- `procurement_categories` and `global_procurement_categories` move from the
  `projects` contribution to `procurement` — they are procurement-domain data.
  The importer maps rows by table name, so the move is transparent for
  post-fold archives.
- With `projects.ship_id` gone, `projects` deps are `[users, tags]` and `ships`
  deps are `[users, projects]`: a one-way edge. **The `projects <-> ships`
  cycle that ADR-004 existed to tolerate no longer exists.**

## Consequences

- Adding a future domain to projects is "write a module and register a
  section" — no edit inside the project module. The registry is the extension
  point the whole refactor was for.
- The `ships` table, the `/ships/*` route tree, the `ships` nav module, the
  `ships` module-gate key and the `ships` PAT scope are all gone. Worklists and
  the global equipment vocabularies moved under the `projects` token scope.
  **Module-gate widening**: a group granted `projects` but not `ships` now
  reaches ship data, and a group granted `ships` but not `projects` loses
  everything. Operators must re-check group grants after the cutover.
- Backup dependency resolution keeps its visiting-set cycle guard and the
  `PRAGMA defer_foreign_keys = 1` restore transaction — both are still correct,
  they are simply no longer load-bearing for projects and ships.
- A project's tabs, its list-filter membership, its overview tiles, its
  settings panels and the capabilities its Roles editor offers are all derived
  from `project_sections`. Losing a mount row silently removes a tab, which is
  why mounts are only ever written inside the create/mount transaction and the
  seed script carries an integrity check.
- The section set must be batch-loaded on the list endpoint
  (`WHERE project_id IN (…)`), never per row; the `?section=` list filter is a
  SQL condition applied before pagination, riding the key-first covering index.

## Review

Revisit by **2027-02-28**, or sooner if a proposed section genuinely cannot be
expressed within the four-field registry contract. At that point, either extend
the contract deliberately in a superseding ADR, or reject the section's shape —
do not widen the registry ad hoc.
