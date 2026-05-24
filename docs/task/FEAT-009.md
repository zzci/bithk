# FEAT-009 — Ship management module

- **status**: completed
- **owner**: e2e-docs
- **plan**: [PLAN-011](../plan/PLAN-011.md)
- **updated**: 2026-05-24

## Scope

Ship management across backend and frontend.

- Admin-created ships with an auto-created base project.
- Base-project membership for read access and `project.manage` for writes.
- Equipment CRUD scoped to each ship.
- Global maintenance-template knowledge base plus independent ship-level
  template copies.
- Maintenance work orders backed by project issues and `issue_references`.
- Ship files through the base project's existing drive FileBrowser.

## Acceptance

- `bun run check` passes.
- `bun run test:e2e` passes.
- The ship main-flow e2e proves ship creation, base project creation, fail-
  closed read authz, base-project member read, `project.manage` write,
  equipment, global-template copy, ship-only template listing, work-order
  references with checklist/precautions and dangling-ref fallback, and project
  drive file access.

## Result

- Added backend, frontend, focused tests, and live e2e coverage for the ship
  module.
- Added final architecture, changelog, and decision documentation.
- `bun run check` passed on 2026-05-24.
- `bun run test:e2e` passed on 2026-05-24.
