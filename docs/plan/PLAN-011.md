# PLAN-011 — Ship management module

- **status**: completed
- **task**: [FEAT-009](../task/FEAT-009.md)
- **updated**: 2026-05-24

## Context

The ship module adds a thin ship aggregate on top of existing project, issue,
and drive building blocks. A ship owns core vessel metadata, equipment, and
ship-level maintenance templates. Its permissions, work orders, and files are
anchored in the base project that is created with the ship.

## Proposal

1. Add ship CRUD, project binding, equipment, and maintenance-template backend
   routes.
2. Create a base project automatically for every ship and use that project as
   the read/write permission anchor.
3. Reuse project issues plus `issue_references` for maintenance work orders.
4. Reuse drive's existing `project` owner type for ship files; do not fork or
   modify drive behavior.
5. Add ship list/detail UI, Equipment and Maintenance tabs, frontend API hooks,
   i18n, focused tests, and one live main-flow e2e suite.

## Risks

- The ship/project circular relationship needs explicit restore handling and a
  documented migration caveat.
- Ship authorization must fail closed for non-base-project members to avoid
  leaking ship existence.
- Maintenance-template references are soft links; missing targets must not
  break old work orders.

## Verification

- `bun run check`.
- `bun run test:e2e`.
- Focused backend/frontend tests for ship APIs, tab rendering, FileBrowser
  reuse, maintenance-template references, and dangling-reference fallback.

## Result

- Implemented and wired the ship module across backend, frontend, and live e2e
  coverage.
- Verified the primary flow: create ship/base project, fail-closed read authz,
  base-project member read, `project.manage` write, equipment, template copy,
  ship-only template listing, work-order references, dangling-ref fallback, and
  project-backed files.
- Finalized docs and recorded the ship/project cycle backup and migration
  decision.
- `bun run check` passed on 2026-05-24.
- `bun run test:e2e` passed on 2026-05-24.
