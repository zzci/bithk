# FEAT-009 — Ship management module

- **status**: completed
- **owner**: frontend
- **plan**: [PLAN-011](../plan/PLAN-011.md)
- **updated**: 2026-05-24

## Scope

Ship management across backend and frontend. This detail file was missing while
the task index already referenced it; this file records the active T5b frontend
slice without changing the broader campaign scope.

## T5b Frontend Slice

- Add Equipment and Maintenance tabs to the existing ship detail registry.
- Consume the merged backend equipment, maintenance-template, global-template,
  maintenance-order, and issue-reference APIs.
- Gate writes on the existing `canManage` context; show global copy only for
  app admins.
- Cover equipment CRUD, ship template create/copy, maintenance work-order
  creation, resolved reference rendering, and dangling-reference fallback.

## Acceptance

- `bun run check` passes.
- T5b scope is committed before reporting completion.

## Result

- Added ship Equipment and Maintenance tabs.
- Added frontend clients, i18n, and Vitest coverage for equipment CRUD,
  maintenance-template management, global-template copy, maintenance work-order
  creation, and maintenance-template reference rendering.
- `bun run check` passed on 2026-05-24.
