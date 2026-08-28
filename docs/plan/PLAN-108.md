# PLAN-108 - Projects as a composition of mounted sections; ships become a preset

- Status: In Progress (revision v2)
- Task: [REFACTOR-039](../task/REFACTOR-039.md)
- Campaign: three-tier BKD, started 2026-08-28 (~4k LOC touched)
- Created: 2026-08-27
- Revised: 2026-08-27 — v2 supersedes the v1 "project `type` enum + ship-only
  tabs" proposal (kept as an alternative at the end).

## v1 -> v2 in one paragraph

v1 folded ships into projects by adding a `type` enum and hard-coding "if
`type = ship`, also show profile / equipment / worklist tabs". That removes the
duplicated module but leaves the project module as the place every future
domain must be patched into. v2 keeps the fold and removes the enum: a project
is a **core record plus a set of mounted sections**, where a section is an
independent sub-module owning its own tables, routes, capabilities, backup
contribution and UI tab. "Ship" stops being a type and becomes a create-time
**preset** that mounts `ship-profile` + `equipment` + `worklist`. Adding a
future domain (certificates, maintenance, crew, …) becomes "write a module,
register a section" with zero edits inside the project module.

## Context (investigation, 2026-08-27)

### Ships are already a satellite of projects (unchanged from v1)

- `createShip` (`apps/api/src/modules/ship/ship.service.ts:197-249`) inserts a
  ship row, then runs the full `createProjectTx` (roles, owner member,
  procurement-category copy), backfills `ships.base_project_id`, copies the
  global equipment-category template, syncs tags. 1 ship = 2 rows.
- Ship authorization is 100% the base project's `PROJECT_CAPABILITIES`
  (`requireShipRead` -> `isMember(baseProjectId)`, `requireShipManage` ->
  `hasCapability(baseProjectId, "project.manage")`; `ship.routes.ts:288-307`).
  There is no ship member/role table and no ship capability.
- Files, issues (work orders), procurement, members, roles and procurement
  categories all live on the base project. The web ship "Files" tab is the
  project `FileBrowser` with `ownerId = ship.baseProjectId`
  (`ships/-ship-files-tab.tsx:21-37`); every ship page derives capabilities via
  `useProject(ship.baseProjectId)`.
- Ship-only data: 14 maritime profile columns + 6-value `status` on `ships`,
  `ship_equipment`, `ship_equipment_categories` (per-ship copy of
  `global_equipment_categories`), `equipment_manufacturers` (global, referenced
  directly), `worklists` (`ship_id NULL` = global template, set = per-ship
  copy), ship cover (`owner_type = 'ship_cover'`), tag type `'ship'`.
- `bindProject` / `unbindProject` (`ship.service.ts:549-593`) is already a flat
  one-level "one privileged base + N bound projects" link stored as
  `projects.ship_id`; bound projects get no permission inheritance.
- No `type` / `kind` / `parent_id` exists on `projects`; the only hierarchy in
  the codebase is `document_details.parent_id`.

### The codebase already composes modules through registries

This is what makes v2 cheap rather than speculative — the pattern exists, it
simply has never been applied *inside* a project.

- ADR-009: the 19 `modules/*/index.ts` barrels **are** the registration
  surface. Import-time side effects wire modules into cross-cutting registries:
  `registerBackupContribution` (15 barrels), `registerSearchSource`,
  `registerTagSource` (wired in `routes/protected.ts:36-41`), cover/attachment
  permission hooks, storage drivers.
- `shared/module-manifest.ts` is a single dependency-free list from which
  `MODULES`, `MODULE_KEYS`, `UNGATED_PREFIXES` and `TOKEN_MODULES` are all
  derived — "a new module edits exactly one list".
- Sections already own their routes today: `procurement.routes.ts` mounts
  `/projects/:projectId/procurements*` and `issue.routes.ts` mounts
  `/projects/:projectId/issues*` — both from their own modules, not from the
  project module. The project module's own routes are only `/projects`,
  `/projects/:id`, `cover-image`, `members`, `roles`,
  `procurement-categories`, plus the two global surfaces.
- `SHIP_TABS` (`ships/-ship-tabs.tsx`) is already a sorted registry with an
  `isVisible(ctx)` hook and a per-tab route file; `PROJECT_TABS`
  (`projects/-project-tabs.ts`) is still a hardcoded 4-value const.
- `PROJECT_CAPABILITIES` (`project/schema.ts:14-38`) is already *commented* as
  grouped by module (issue / procurement / files / project-admin); the grouping
  is convention, not data.
- The backup registry supports `BackupImportTransform` with
  `TransformContext.setMappedId` (old id -> live id), i.e. a v2 archive can be
  folded into a v3 schema at import time.

### Misplacements the section model fixes

- `global_procurement_categories` + `procurement_categories` are declared in
  `project/schema.ts` and copied inside `createProjectTx`, although they are
  procurement-domain data (mirror image: `global_equipment_categories` sits in
  the ship module and is copied in `createShip`).
- `GET /projects/:projectId/referenceable-worklists` lives in
  `issue.routes.ts:194-205` and imports `ship.worklist.service`, i.e. the issue
  module reaches into the ship module to answer a project question.
- `project.service.ts:196-232` implements a "base project inherits the ship
  cover" fallback that only exists because of the two-row model.
- Backup carries an explicit `projects <-> ships` dependency cycle (ADR-004).

### Blast radius (measured)

- `routes/_app/ships/` = 3260 LOC non-test + 1500 LOC tests; ~1.3k LOC is
  route/registry/relationship plumbing that disappears, ~2k LOC (profile,
  equipment, equipment-categories, worklist, overview, form) moves into section
  tabs. `locales/*/ships.json` = 182 keys x 2; 13 of 18 top-level groups
  collide with `projects.json`, so ship keys keep their own namespace.
- `project.service.ts` 36.3K + `project.routes.ts` 33.5K; `ship.service.ts`
  23.0K + `ship.routes.ts` 43.4K.
- Cross-module coupling by name only: search source `ships` / hit type `ship`,
  nav module + PAT scope key `ships`, backup contribution `ships`, tag types
  `ship` / `worklist`, `issue_references.refType = 'worklist'`, seed payloads
  `ships.json` / `worklists.json`.
- Registries that ignore ships today and cover them for free after the fold:
  favorites (`project|issue|procurement`), overview tiles, page-title
  `staticData`, `FavoriteToggle`.

## Proposal

### 1. The core project

`projects` keeps only what every project has, in three groups:

- identity / metadata: `id`, `short_id`, `code`, `name`, `status`
  (`active|archived`), `description`, `cover_reference_id`, `creator_id`,
  `version`, `deleted_at`, `updated_at`;
- hierarchy: `parent_id` self-FK (`ON DELETE SET NULL`, indexed), one level
  enforced in the service (a project with a parent cannot become a parent);
- permission anchor: `project_roles` + `project_members` (unchanged).

Removed from core: `ship_id`, the ship-cover fallback, and the
procurement-category tables (moved to the procurement module, below).

### 2. `project_sections` — the mount table

```
project_sections(project_id FK cascade, key text, sort_order int, created_at)
PRIMARY KEY (project_id, key)
INDEX (key, project_id)   -- "all projects with the ship-profile section"
```

Row present = section mounted. This is the single source of truth for "what
this project is". No `type` column: a project that has `ship-profile` mounted
*is* a ship, and the list filter, icon and card layout read the section set
(see Alternatives for why the denormalized enum was dropped).

`ProjectView` gains `sections: string[]`, so the web assembles tabs from the
payload it already fetches.

### 3. The section registry (API)

`modules/project/section.registry.ts`, dependency-free like
`module-manifest.ts`:

```ts
export interface ProjectSectionDefinition {
  readonly key: string;                       // "issues" | "equipment" | ...
  readonly capabilities?: readonly ProjectCapability[];
  readonly provision?: (tx, projectId, ctx) => Promise<void>;   // copy-on-create
  readonly hasData?: (db, projectId) => Promise<boolean>;       // guards unmount
}
export function registerProjectSection(def: ProjectSectionDefinition): void;
```

Each section registers itself from its **owning module's barrel** (ADR-009):
`issue/index.ts` -> `issues`, `procurement/index.ts` -> `procurement` (with the
category copy as its `provision`), `drive/index.ts` -> `files`,
`ship/index.ts` -> `ship-profile`, `equipment`, `worklist`. The project module
imports no domain module; domain modules import only `projects` (schema + the
capability helper). The `projects <-> ships` cycle dies in code as well as in
backup.

Gating is one shared middleware, `requireSection(key)`: 404 when the project
has no such row (fail-closed existence policy, ADR-003). Sections keep today's
per-route capability gates.

**Core, not sections**: the overview tab (the project index) and the
sub-projects tab. Both exist for every project by definition — overview is the
assembly point itself, and sub-projects belong to the core `parent_id`
hierarchy. Overview renders one tile per *mounted* section, contributed through
the registry, so it stops hard-coding "issues + procurement" counts.

**Registering the three existing project domains costs almost nothing** — they
are already independent modules, which is why the section model is a
formalisation rather than a rewrite:

| Section | Today | Work to register |
| --- | --- | --- |
| `issues` | own module, own tables, own routes at `/projects/:projectId/issues*`, own capabilities, own backup contribution, own search source (`module: "projects"`), own tag binding | registry entry + `requireSection` on its routes; no table moves |
| `procurement` | own module, tables, routes, capabilities, backup contribution — **but** `global_procurement_categories` + `procurement_categories` are declared in `project/schema.ts` and copied inside `createProjectTx` | move those two tables into `procurement/schema.ts`, move the copy into the section's `provision`, move them into the procurement backup contribution; the only real migration in this group |
| `files` | drive entries with `ownerType = "project"` (`DRIVE_OWNER_TYPES`), `files.view` / `files.manage` capabilities already in `PROJECT_CAPABILITIES` | registry entry only. The section governs the project surface (`/projects/:id/files`), never the top-level `/drive` module |

Out of scope here: the top-level `documents` module is not project-scoped at
all today (documents are Tier-C `items` with no `projectId`), so "project
documents" is a new feature, not a re-homing. It is specified separately in
[PLAN-110](PLAN-110.md), sequenced right after this one and deliberately framed
as the acceptance test for this design: landing a `documents` section must not
touch `modules/project/` beyond the preset list.

Presets are a static map, not a table:

```ts
export const PROJECT_PRESETS = {
  general: ["issues", "procurement", "files"],
  ship:    ["issues", "procurement", "files", "ship-profile", "equipment", "worklist"],
} as const;
```

`POST /projects` takes `preset` (default `general`) plus optional `parentId`;
in one transaction it writes the core row, roles + owner member, one
`project_sections` row per preset key, and calls each section's `provision`
(procurement copies the global categories, equipment copies the global
equipment-category template, `ship-profile` inserts the profile row from the
payload, the rest are no-ops).

`PUT /projects/:id/sections/:key` mounts a section later,
`DELETE /projects/:id/sections/:key` unmounts it — both `project.manage`;
unmount refuses while `hasData()` is true (v1 rule: no data loss, no soft
"disabled" state).

### 4. Capabilities stay one list, tagged by section

`PROJECT_CAPABILITIES` remains a literal in `project/schema.ts` (roles validate
their JSON array against it, and a derived-across-modules union would create
type cycles), but gains a sibling map `CAPABILITY_SECTION: Record<Capability,
sectionKey>`. Effects: the Roles editor groups capabilities by section and
hides capabilities of sections the project has not mounted; the registry's
`capabilities` field is compile-time checked against the same literal.

v1 of the implementation adds **no new capabilities**: the three ship sections
keep today's gating (`member` to read, `project.manage` to write), so no role
migration and no group re-grant. Splitting `equipment.view/manage` and
`worklist.manage` out is a follow-up the mechanism already supports.

### 5. Ship data becomes three sections

- `ship_profiles` (`project_id` PK -> `projects.id` CASCADE): `hull_number`
  (unique; today's `ships.code`), `ship_status` (the 6-value enum), the 14
  maritime columns, `description`. A 1:1 side table, not 14 nullable columns on
  `projects`; "section mounted" and "profile row exists" stay equivalent.
- `ship_equipment` / `ship_equipment_categories`: `ship_id` -> `project_id`.
  Table names keep the `ship_` prefix: they are maritime-domain tables owned by
  the ship module, and the section being called `equipment` does not make its
  contents generic. (With the baseline re-squashed there is no diff cost either
  way — the choice is naming, not migration.)
- `worklists`: `ship_id` -> `project_id` (`NULL` still = global KB entry).
- Global vocabularies (`global_equipment_categories`,
  `equipment_manufacturers`, global worklists) are unchanged and stay
  admin-only, moving under the `projects` token-scope prefix set.
- Dropped: `ships`, `projects.ship_id`, `ships.base_project_id`. Ship cover
  becomes the project cover (`project_cover`); tag type `ship` folds into
  `project`.

Routes: `/projects/:id/ship-profile`, `/projects/:id/equipment[...]`,
`/projects/:id/equipment-categories[...]`, `/projects/:id/worklists[...]`,
each wrapped in `requireSection`. `/projects/:id/children` (list / create /
link / unlink) replaces `/ships/:id/projects`.
`/projects/:id/referenceable-worklists` moves from the issue module to the
worklist section (the issue module keeps only the reference-creation route).

### 6. Delete / archive semantics

Ship-type project delete follows `softDeleteProject` (cascade to
issues/procurement) — a change from today's admin-only ship delete that left
the base project alive. Sub-projects are unlinked (`parent_id` nulled), never
cascade-deleted. `projects.status = archived` continues to hide a project from
the default list; `ship_status = retired` is a profile field and is filtered
separately (both filters stay explicit on the list).

### 7. Module gate, search, backup

- Module manifest: the `ships` nav key and `ships` token scope disappear;
  `/projects` already claims every `/projects/*` section route, so sections add
  no manifest entries. `/worklists`, `/global-equipment-*` re-key to the
  `projects` scope. Group grants and `account.default_modules` values
  containing `ships` migrate to `projects`.
- Search: the `ships` source is removed; project hits carry `sections` so the
  palette renders a ship icon for ship projects.
- Backup: contribution `projects` = `projects`, `project_roles`,
  `project_members`, `project_sections`; contribution `procurement` gains
  `global_procurement_categories` + `procurement_categories`; contribution
  `ship` = `global_equipment_categories`, `equipment_manufacturers`,
  `ship_profiles`, `ship_equipment_categories`, `ship_equipment`, `worklists`
  with `deps: ["projects"]` and no cycle. `BACKUP_FORMAT_VERSION` 2 -> 3 marks
  the epoch reset — see below.

### 8. Web

- `projects/-project-sections.ts` mirrors the API keys: `{ key, labelKey, i18n
  namespace, order, routeSegment, capability?, isVisible(ctx) }`, sorted like
  `SHIP_TABS`. `PROJECT_TABS` / `PROJECT_TAB_TO` / `activeProjectTab` are
  derived from it. Route files stay static per section
  (`$projectId.<segment>.{tsx,lazy.tsx}`); each body 404s when the section is
  not in `project.sections`.
- Project settings dialog gets the same treatment: section-contributed panels
  (`equipmentCategories` for the equipment section), replacing the cloned ship
  settings dialog.
- `/projects` list: filter chip driven by sections ("All / Ships / …"), a
  section-aware card (ship card keeps IMO / MMSI / spec rows). Sidebar keeps a
  "Ships" entry as a preset link to `/projects?section=ship-profile`.
- Create dialog: preset picker (General / Ship); Ship reveals hull number +
  status + particulars (reusing `-ship-form-logic.ts` validation).
  "Create sub-project" on the Sub-projects tab pre-fills `parentId`.
- `/ships/*` route tree deleted; `-ships.nav.ts`, `ModuleKey`, group labels,
  palette `ships` section, `CoverKind = "ship"`, token scope label removed or
  folded. Favorites, overview tiles and page titles now cover ships for free.

### 9. Non-goals (guardrails against over-abstraction)

The registry stays a ~150 LOC static list. Explicitly **not** in scope: dynamic
/ runtime plugin loading, per-section JSON config columns, section versioning,
per-section membership or roles, permission inheritance from parent to
sub-project, hierarchies deeper than one level, generic "custom field"
builders, or a section marketplace. A section is plain code that registers
itself; the only data is the mount row.

## Schema epoch reset (decided 2026-08-28)

**Decision**: reset the schema outright. No data migration, no historical
compatibility, in either direction.

- **Database**: re-squash the Drizzle baseline from the new schema (single
  fresh `0000_*.sql`, as the current tree already has after the PLAN-105
  collapse) and rebuild with `bun run seed`. No fold script, no in-place ALTER
  chain, no backfill of existing rows — there are no rows to carry. Matches the
  standing "dev phase: reset DB freely" rule.
- **Archives**: `BACKUP_FORMAT_VERSION` 2 -> 3. The manifest version gate is an
  exact-match check (`import.service.ts:214`), so every pre-fold archive is
  refused with `Unsupported backup format version 2` for one line of change,
  on both the merge and replace paths. Error text should name the reset so the
  message is actionable.
- **Seed** becomes the only path into the new schema: `payload/ships.json`
  turns into ship-preset project payload, and the seeded projects get their
  `project_sections` rows through the normal create path (not hand-inserted),
  so the seed doubles as a provisioning test.

Why a version bump rather than a targeted "reject archives containing `ships`"
guard: with no compatibility obligation the precise guard buys nothing, and
`formatVersion` is the honest place to record "everything before this line is
unsupported". This is an explicit **one-time epoch marker**, documented in
ADR-015 — the cross-schema mapping engine (PLAN-075 rules 1-15,
`importFallbacks` / `importTransforms`) keeps its full value for v3-and-later
archives whose schema has drifted, which is what it was built for.

For the record, the reason old archives cannot simply be let through: the
mapping engine would accept a pre-fold archive and degrade it, mostly
silently — `ships` skipped wholesale (rule 7), equipment failing on the new
NOT-NULL `project_id` (rule 5), per-ship worklists silently becoming global KB
entries (rule 3), and — for *any* pre-fold archive, ship data or not — no
`project_sections` rows at all (rule 9), leaving every imported project without
its Issues / Procurement / Files tabs.

This also drops the `importTransforms` work and, with it, the verified
transform-ordering hazard for vanished parent tables
(`import-mapping.ts:558-561`, where `ships` would have been processed after the
child tables that need its id map). No backup-engine change beyond the
constant.

## Risks

- **Abstraction cost**: the section indirection is only worth it if the
  registry stays tiny and static. Review gate: if `section.registry.ts` grows a
  config object or a runtime loader, the design has drifted — see Non-goals.
- **Missing mount rows**: a project without an `issues` row loses its Issues
  tab with no error. Mitigations: preset seeding inside the create transaction
  (the only way rows are ever written), an integrity check in the seed script,
  and a test asserting every non-deleted project has the general preset
  mounted.
- **N+1 on the list endpoint**: section sets must be batch-loaded for the page
  (`WHERE project_id IN (...)`), not per row.
- **Backup contribution regrouping**: `procurement_categories` moves from the
  `projects` contribution to `procurement`. The importer maps rows by table
  name, so this should be transparent for post-fold archives — must be proven
  by a round-trip test before merge, not assumed.
- **The reset is irreversible and unconditional.** Every existing database and
  every archive taken before the fold becomes unusable: recovering anything
  from them means checking out a pre-fold build and running it against a copy.
  Accepted deliberately under the dev-phase rule — but if any deployed
  instance is holding data worth keeping, it must be exported to a
  human-readable form (or that instance abandoned) *before* the campaign
  starts, not after. Call it out in the changelog and `docs/modules/backup.md`,
  and take a fresh archive immediately after cutover.
- **`code` collision**: base projects use `p-<shortId>`; the ship hull number
  (mutable, not lowercased) moves to `ship_profiles.hull_number`, so
  `projects.code` stays immutable/lowercase. UI that showed the ship code as
  the identifier now shows the hull number.
- **Module-gate widening**: groups granted `projects` but not `ships` gain ship
  access after the fold (and vice versa). Acceptable in dev phase; call out in
  the changelog.
- **Generated artifacts** (`api-spec.json`, `api-routes.md`, `api-types.ts`,
  `api-catalog.md`) plus ~10 web and ~8 api ship test files must be
  regenerated / rewritten; the CI docs-drift gate fails until done.
- **ADR churn**: ADR-004 (ship/project cycle) is superseded by ADR-015
  ("projects are compositions of sections; ships are a preset").
- **Concurrency**: clear at proposal time — UI-031 (cover lightbox) landed at
  `27882ff2`, so `cover-image.tsx` / `CoverKind` are free. Re-check before the
  campaign starts.
- **Scope**: v2 is larger than v1 by roughly one lane (registry + moving
  procurement categories + registering the three built-in sections). It is also
  where the extensibility the task asks for actually comes from; a smaller
  variant is listed under Alternatives.

## Scope / lane split (proposed)

- **L2-A api-core** (blocking): `parent_id`, `project_sections`, section
  registry + `requireSection`, presets, `POST /projects` provisioning,
  `/projects/:id/children`, `/projects/:id/sections/:key`,
  `CAPABILITY_SECTION`, core backup contribution, the re-squashed baseline, and
  `BACKUP_FORMAT_VERSION` 3 + its rejection message. Trims
  `project.service.ts` to core + members/roles/hierarchy/sections.
- **L2-B api-ship**: `ship_profiles`, re-key equipment / categories /
  worklists to `project_id`, register the three ship sections, delete
  `/ships/*` + the `ships` table, module manifest, ship backup contribution,
  cover fold, tests.
- **L2-C api-move**: procurement categories move into the procurement module,
  register `issues` / `procurement` / `files` sections, re-home
  `referenceable-worklists`, search source removal, tests.
- **L2-D web**: section registry, tabs, settings panels, list filter, create
  preset dialog, sub-projects tab, delete `/ships/*`, nav/palette/cover
  registries, i18n, tests.
- **L2-E data/docs**: seed payload + script, generated api docs/spec/types,
  `docs/modules/project.md` + `ship.md` removal, `docs/modules/backup.md`
  (archives are not portable across the fold), `architecture.md`, ADR-015,
  changelog.

Order: A -> (B, C in parallel) -> D -> E, then L1 merge + `bun run check` +
a from-scratch `bun run seed` rebuild.

## Alternatives

- **v1 (superseded)**: `projects.type` enum + hard-coded ship tabs. Smaller by
  about one lane and removes the duplicate module, but every future domain
  keeps editing the project module, the `type` enum grows one value per
  combination, and procurement categories / referenceable-worklists stay
  misplaced. Reasonable fallback if the campaign must be cut down; the data
  model is forward-compatible (adding `project_sections` later is additive).
- **Keep `projects.type` alongside `project_sections`** as a denormalized
  label for filtering and icons: cheaper list queries, but two sources of truth
  for "is this a ship", which drift the moment a section is mounted manually.
  Rejected — the indexed `project_sections(key, project_id)` lookup is
  sufficient at this scale.
- **Keep two modules, add only `parent_id`** and re-express `bindProject` as
  sub-projects: smallest diff, but leaves the 2-rows-per-ship model, the
  duplicated settings/list/tab surfaces, and the circular FK in place.
- **Put the 14 maritime columns on `projects`** instead of `ship_profiles`:
  fewer joins, but 14 always-null columns for general projects and a
  `hull_number` unique index over a mostly-NULL column. Rejected.
- **Fully generic sections** (per-section config JSON, runtime-registered
  custom sections, per-section permissions): rejected as speculative; see
  Non-goals.
