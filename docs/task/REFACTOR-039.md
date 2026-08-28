# REFACTOR-039 - Projects as a composition of mounted sections; ships become a preset

- Status: Proposed
- Plan: [PLAN-108](../plan/PLAN-108.md)
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
- Migration: the one-shot fold script turns a pre-fold database into a new
  one — ships onto their base projects, sections mounted, equipment /
  worklists / ship tags / ship covers re-keyed, `ships` module grants and PAT
  scopes rewritten — verified rule by rule against a committed pre-fold
  fixture, with a reconciliation report and a non-zero exit on unexplained row
  loss.
- Backup: pre-fold archives are refused with an error naming the migration
  script; round-trip test proving the `procurement_categories` contribution
  move is transparent for post-fold archives.
- Web: `/projects` list filters by section; ship tabs appear only for projects
  with the ship sections; `/ships/*` removed; registries (sidebar, search,
  favorites, overview, page titles) work for ship projects.
- `bun run check` EXIT 0; generated api-docs / api-spec / api-types
  regenerated; seed rebuild green.
