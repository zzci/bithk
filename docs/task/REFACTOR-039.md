# REFACTOR-039 - Projects as a composition of mounted sections; ships become a preset

- Status: Completed (2026-08-28)
- Plan: [PLAN-108](../plan/PLAN-108.md)
- Decision: [ADR-015](../decisions/015-projects-as-sections.md)
- Created: 2026-08-27
- Revised: 2026-08-27 (v2 — section registry replaces the project `type` enum)

## Goal

A ship is today a separate module that is, in practice, "a project plus a
maritime profile, equipment, and worklists": its permissions, members, files,
work orders, and procurement already live on an auto-created base project.
Rather than folding ships in as a special-cased project `type`, make the
project a composition:

- the core `projects` record keeps only its own metadata, hierarchy
  (`parent_id`, one level of sub-projects) and its permission anchor
  (members / roles);
- everything else is a **section** — an independent sub-module owning its
  tables, routes (`/projects/:id/<section>`), capabilities, backup
  contribution and UI tab — mounted on a project through `project_sections`;
- `issues`, `procurement`, `files` become sections of the default preset;
  `ship-profile`, `equipment`, `worklist` become sections of a `ship` preset,
  provisioned at create time (profile row + equipment-category template copy);
- the standalone `ships` module, `/ships/*` routes, and the `ship` nav /
  module-gate / PAT scope key disappear.

Adding a future domain to projects becomes "write a module and register a
section", with no edit inside the project module.

## Scope

See PLAN-108 for the approach, the registry contract, migration hazards and
the lane split. Out of scope (PLAN-108 "Non-goals"): runtime/dynamic section
loading, per-section config columns, per-section membership or roles,
permission inheritance from parent to sub-project, hierarchies deeper than one
level, custom-field builders.

## Verification

- API: create with `preset: "ship"` mounts six sections, inserts the profile
  and copies the equipment categories; `requireSection` 404s an unmounted
  section; mount / unmount routes; unmount refused while the section has data;
  sub-project create / list / unlink; module gate and PAT scope tests updated.
- Every existing project carries the general preset after migration/seed
  (integrity test), and the project list batch-loads section sets (no N+1).
- Schema reset: the Drizzle baseline is re-squashed from the new schema and
  `bun run seed` builds a working database from scratch, with seeded ship
  projects going through the normal create path (no hand-inserted section
  rows). No data migration and no backfill — pre-fold databases are not
  carried across.
- Backup: `BACKUP_FORMAT_VERSION` 3 refuses every pre-fold archive with an
  actionable message; round-trip test proving the `procurement_categories`
  contribution move is transparent for post-fold archives.
- Web: `/projects` list filters by section; ship tabs appear only for projects
  with the ship sections; `/ships/*` removed; registries (sidebar, search,
  favorites, overview, page titles) work for ship projects.
- `bun run check` EXIT 0; generated api-docs / api-spec / api-types
  regenerated; seed rebuild green.

## As implemented — deviations from the plan (2026-08-28)

The campaign shipped; where the merged code and this plan differ, **the code is
right**. Full detail in [PLAN-108](../plan/PLAN-108.md).

- **`ships.description` folded into `projects.description`.** The plan listed a
  description in both places, which would have given the UI two competing
  fields. `ship_profiles` has **no** `description` column: one project, one
  description.
- **`hull_number` is NOT NULL + UNIQUE**, so a ship-preset create that supplies
  no hull number auto-generates `S-<last 8 chars of the project ULID,
  uppercased>` rather than leaving the column empty. The value is mutable and
  case-preserving (unlike `projects.code`), so an operator renames it later; a
  collision surfaces as `422 { hullNumber: "Already exists" }`.
- **`GET /projects/:projectId/referenceable-worklists` kept its
  `{ ship, global }` payload shape.** The `ship` group now means "**this
  project's own** worklists" — the key was left alone rather than renamed, so
  no client change was needed.
- **The sub-projects TAB is gated on the `ship-profile` section.** Children
  exist for every project on the API (`/projects/:id/children` is core, not a
  section); only the web tab follows the ship preset, because it replaced the
  old ship↔project binding surface and a plain project has no use for it in v1.
- **The moved procurement-category routes kept `tags: ["projects"]`** in their
  OpenAPI metadata. Moving them into the procurement module was a *re-home, not
  a retag*, so the generated API grouping and any client keyed on that tag are
  unchanged.
