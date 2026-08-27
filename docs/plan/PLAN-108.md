# PLAN-108 - Fold ships into projects: project type, sub-projects, ship-type auto-provisioned modules

- Status: Proposed
- Task: [REFACTOR-039](../task/REFACTOR-039.md)
- Campaign: TBD (three-tier BKD expected; >3k LOC touched)
- Created: 2026-08-27

## Context (investigation, 2026-08-27)

Ships are already a thin satellite of projects:

- `createShip` (`apps/api/src/modules/ship/ship.service.ts:197-249`) inserts a
  ship row, then runs the full `createProjectTx` (roles, owner member,
  procurement-category copy), backfills `ships.base_project_id`, copies the
  global equipment-category template, syncs tags. 1 ship = 2 rows.
- Ship authorization is 100% the base project's `PROJECT_CAPABILITIES`
  (`requireShipRead` -> `isMember(baseProjectId)`, `requireShipManage` ->
  `hasCapability(baseProjectId, "project.manage")`; `ship.routes.ts:288-307`).
  There is no ship member/role table and no ship capability.
- Files, issues (work orders), procurement, members, roles, procurement
  categories all live on the base project. The web ship "Files" tab is the
  project `FileBrowser` with `ownerId = ship.baseProjectId`
  (`apps/web/src/app/routes/_app/ships/-ship-files-tab.tsx:21-37`). Every ship
  page derives capabilities via `useProject(ship.baseProjectId)`.
- Ship-only data: 14 maritime profile columns + 6-value `status` on `ships`,
  `ship_equipment`, `ship_equipment_categories` (per-ship copy of
  `global_equipment_categories`), `equipment_manufacturers` (global, referenced
  directly), `worklists` (`ship_id NULL` = global template, set = per-ship copy),
  ship cover (`owner_type = 'ship_cover'`), tag type `'ship'`.
- `bindProject` / `unbindProject` (`ship.service.ts:549-593`) is already a
  flat one-level "one privileged base + N bound projects" link stored as
  `projects.ship_id`. Bound projects get no permission inheritance.
- No `type` / `kind` / `parentId` exists on `projects`; the only hierarchy in
  the codebase is `document_details.parent_id` (recursive CTE precedent in
  `document.service.ts`).
- Cross-module coupling by name only (no other module stores `shipId`):
  search source `"ships"` / hit type `"ship"`, nav module + PAT scope key
  `ships` (`shared/module-manifest.ts:63-64`), backup contribution `"ships"`
  with the `projects <-> ships` cycle guard (ADR-004), tag types `ship` /
  `worklist`, `issue_references.refType = 'worklist'`,
  `GET /projects/:id/referenceable-worklists` resolving via `projects.shipId`,
  seed (`payload/ships.json`, `worklists.json`).
- Registries that ignore ships today and would cover ship-type projects for
  free after the fold: favorites (`project|issue|procurement`), overview
  dashboard tiles, page-title `staticData`, `FavoriteToggle` on the card.
- Web size: `routes/_app/ships/` = 3260 LOC non-test + 1500 LOC tests;
  ~1.3k LOC is route/registry/relationship plumbing that disappears, ~2k LOC
  (profile, equipment, equipment-categories, worklist, overview, form) moves
  into conditional project tabs. `locales/*/ships.json` = 182 keys x 2; 13 of
  18 top-level groups collide with `projects.json` (`status.active` means
  different things), so keys stay under a `ship.*` prefix or keep the
  `ships` namespace loaded by the project routes.
- Prior art: PLAN-011 built the ship module deliberately as an aggregate over
  project/issue/drive; ADR-004 accepted the circular FK and documented
  restore-by-re-create; PLAN-017 made ships/projects visually independent
  surfaces (UI only, no data-model reason).

## Proposal

### Data model

1. `projects.type` text enum `["general", "ship"]`, NOT NULL default
   `general`. `projects.parent_id` nullable self-FK (`ON DELETE SET NULL`),
   indexed; service enforces one level (a parent cannot itself have a parent)
   and same-type-agnostic children.
2. New 1:1 table `ship_profiles` (`project_id` PK -> `projects.id` CASCADE):
   `hull_number` (unique; today's `ships.code`), `ship_status` (the 6-value
   enum), the 14 maritime columns. Keeping the profile in its own table avoids
   14 nullable columns on `projects`, keeps `projects.status`
   (`active|archived`) semantics untouched, and makes "ship module present"
   equal to "profile row exists".
3. `ship_equipment.ship_id`, `ship_equipment_categories.ship_id`,
   `worklists.ship_id` -> `project_id` (FK to `projects`). Global vocabularies
   (`global_equipment_categories`, `equipment_manufacturers`, global
   worklists) unchanged.
4. Drop `ships`, `projects.ship_id`, `ships.base_project_id`. Ship cover
   becomes the project cover (`project_cover`); the "base project inherits
   ship cover" fallback (`project.service.ts:196-232`) is deleted. Tag type
   `ship` folds into `project` tags.

### Behaviour

5. `POST /projects` accepts `type` and optional `parentId`; when
   `type = "ship"` the create transaction also inserts the profile row and
   copies the global equipment-category template (same copy-on-create pattern
   as procurement categories). Ship-type projects additionally accept the
   profile fields on create/update via `PATCH /projects/:id/ship-profile`
   (or inline; decide in implementation).
6. Ship sub-routes move under the project: `/projects/:id/ship-profile`,
   `/projects/:id/equipment[...]`, `/projects/:id/equipment-categories[...]`,
   `/projects/:id/worklists[...]`; gated `member` (read) /
   `project.manage` (write) exactly as today, plus a 404 when the project is
   not ship-type. `/projects/:id/children` (list / create / link / unlink)
   replaces `/ships/:id/projects`. `/worklists*` (global template) and
   `/global-equipment-*` stay admin-only and move under the `projects` module
   prefix set.
7. Delete semantics: ship-type project delete follows `softDeleteProject`
   (cascade to issues/procurement) - this is a change from today's
   admin-only ship delete that left the base project alive; sub-projects are
   unlinked (`parent_id` nulled), not deleted.
8. Module gate / PAT: `ships` key removed; group grants and
   `account.default_modules` values containing `ships` are migrated to
   `projects`; `scope.test.ts`, `module-gate.test.ts`, `users.routes.test.ts`
   updated.
9. Search: the `ships` source is removed; project hits carry `type` so the
   palette can still show a ship icon. Backup: contribution `ships` becomes
   `ship_profiles` + equipment + worklists tables inside the `projects`
   closure (or its own contribution with `deps: ["projects"]`, no cycle);
   `BACKUP_FORMAT_VERSION` 2 -> 3.

### Web

10. `/ships/*` route tree removed. `/projects` list gains a `type` filter
    dimension (chips: All / General / Ship) and a type-aware card (ship card
    keeps IMO/MMSI/spec rows). Sidebar keeps a "Ships" entry as a preset link
    to `/projects?type=ship` under the `projects` module (navigation habit
    preserved at zero data-model cost).
11. Project detail tab registry becomes data-driven with `isVisible(ctx)`
    (the ship registry already has this hook): `overview`, `profile*`,
    `equipment*`, `worklist*`, `sub-projects`, `issues`, `procurement`,
    `files` (`*` = ship-type only). Settings dialog gains the
    `equipmentCategories` section for ship-type projects; the ship settings
    dialog clone is deleted.
12. Create dialog: type selector (General / Ship); choosing Ship reveals
    hull number + status + the particulars form (`-ship-form-logic.ts`
    validation reused). "Create sub-project" action on the parent's
    Sub-projects tab pre-fills `parentId`.
13. Registries: `-ships.nav.ts`, `ModuleKey`, `MODULE_KEYS`, group labels,
    command-palette `ships` section, `CoverKind = "ship"`, tokens scope label
    removed / folded. Favorites, overview tiles, page titles now cover ships.

### Migration strategy (decide before implementation)

- Option A (dev-phase, recommended): re-squash the Drizzle baseline from the
  new schema, rebuild via `bun run seed` (seed already builds ships through
  the service layer; `payload/ships.json` becomes ship-type project payload).
  Backup import rejects v2 dumps that contain a `ships` module with a clear
  error. Matches the standing "dev phase: reset DB freely" rule.
- Option B: one-shot data migration that folds each ship onto its base
  project (type = ship, profile row from the ship columns, rewrite
  `ship_id` -> base project ULID in equipment / categories / worklists /
  `tags_refs`, bound projects -> `parent_id`), plus a v2 -> v3 backup
  upgrade function. Roughly +1 lane of work and the only path if any
  non-disposable database exists.

## Risks

- `code` collision: base projects already use `p-<shortId>`; ship `code`
  (hull number, mutable, not lowercased) moves to `ship_profiles.hull_number`
  so `projects.code` stays immutable/lowercase. Any UI that showed the ship
  code as the identifier now shows the hull number.
- Module-gate widening: groups granted `projects` but not `ships` gain ship
  access after the fold (and vice versa). Acceptable in dev phase; call out
  in the changelog.
- Status semantics: `projects.status = archived` hides a ship-type project
  from the default list; `ship_status = retired` does not (today `retired`
  is excluded by default). Keep both filters explicit on the list.
- Generated artifacts (`api-spec.json`, `api-routes.md`, `api-types.ts`,
  `api-catalog.md`) and ~10 web + ~8 api ship test files must be regenerated
  / rewritten; CI docs-drift gate fails until done.
- ADR-004 is superseded (write ADR-015 "ships are ship-type projects").
- Concurrency: the ship module is touched by no in-flight campaign, but
  UI-031 (cover lightbox) is modifying `cover-image.tsx`, which this plan
  also edits (`CoverKind`). Land UI-031 first.

## Scope / lane split (proposed)

- L2-A api: schema + migration/baseline, project service/routes (type,
  parentId, children), ship sub-routes re-keyed on `projectId`, module
  manifest, backup v3, api tests.
- L2-B web: project routes (tabs, list filter, create dialog, settings
  section, sub-projects tab), delete `/ships/*`, registries, i18n, web tests.
- L2-C data/docs: seed payload + seed script, generated api docs/spec/types,
  `docs/modules/project.md` + `ship.md` removal, `architecture.md`, ADR-015,
  changelog.

Order: A -> (B, C in parallel) -> L1 merge + `bun run check` + seed rebuild.

## Alternatives

- Keep two modules, add only `parent_id` to projects and re-express
  `bindProject` as sub-projects: smaller, but leaves the 2-rows-per-ship
  model, duplicated settings/list/tabs, and the circular FK in place. Not
  recommended; the fold is where the simplification comes from.
- Put the 14 maritime columns directly on `projects` instead of
  `ship_profiles`: fewer joins, but 14 always-null columns for general
  projects and a `hull_number` unique index over a mostly-NULL column.
  Rejected.
