# REFACTOR-039 - Fold ships into projects: project type, sub-projects, ship-type auto-provisioned modules

- Status: Proposed
- Plan: [PLAN-108](../plan/PLAN-108.md)
- Created: 2026-08-27

## Goal

A ship is today a separate module that is, in practice, "a project plus a
maritime profile, equipment, and worklists": its permissions, members, files,
work orders, and procurement already live on an auto-created base project.
Collapse the two concepts so that:

- a project carries a `type` (`general` | `ship`);
- a project may have sub-projects (`parentId`, one level);
- creating a ship-type project auto-provisions the ship-specific modules
  (profile, equipment + category template copy, worklists) as extra tabs;
- the standalone `ships` module, `/ships/*` routes, and the `ship` nav /
  module-gate / PAT scope key disappear.

## Scope

See PLAN-108 for the approach, migration hazards, and lane split. Out of
scope: permission inheritance from parent to sub-project (keep today's
"each project owns its members/roles" rule), recursive hierarchies deeper
than one level, project templates beyond the existing copy-on-create
vocabularies.

## Verification

- API: ship-type project create provisions profile + equipment categories;
  sub-project create/list/unlink; module gate and PAT scope tests updated.
- Web: `/projects` list with type filter; ship tabs visible only on
  `type === "ship"`; `/ships/*` routes removed; registries (sidebar, search,
  favorites, overview) work for ship-type projects.
- Backup: format version bump; seed rebuild green.
- `bun run check` EXIT 0; generated api-docs / api-spec / api-types
  regenerated.
