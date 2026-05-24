# PLAN-011 — Ship management module

- **status**: completed
- **task**: [FEAT-009](../task/FEAT-009.md)
- **updated**: 2026-05-24

## Context

The task and plan indexes already contain FEAT-009 / PLAN-011 entries, but the
detail files were absent in this worktree. The current T5b campaign extends the
merged ship frontend scaffolding:

- `apps/web/src/app/routes/_app/ships/-ship-tabs.tsx` owns a data-driven tab
  registry with reserved order slots for Equipment (20) and Maintenance (30).
- `apps/web/src/shared/lib/api/ships.ts` currently covers core ship and
  ship-project APIs only.
- Backend routes are present for ship equipment, ship-level maintenance
  templates, global maintenance templates, issue references, and ship
  maintenance orders.
- Existing project issue creation already accepts `references[]`; T5b should
  reuse it instead of creating a new work-order-specific endpoint.

## Proposal

1. Extend the ship API client with typed hooks for equipment, maintenance
   templates, global templates, maintenance orders, issue references, and
   work-order issue creation.
2. Add `-ship-equipment-tab.tsx` for list, create, edit, delete, and states.
3. Add `-ship-maintenance-tab.tsx` for ship-template management, admin-only
   copy from global knowledge base, maintenance-order list, create from
   template, and inline reference rendering.
4. Register exactly two new tab entries in `-ship-tabs.tsx`.
5. Add synchronized EN/ZH i18n keys and focused Vitest coverage.

## Risks

- Maintenance orders expose an internal project id in the list response, so the
  ship tab should render detail inline and use the ship base project short id
  only for newly created work orders.
- Global template browse is admin-only. The UI must not call it for non-admins.
- Deleted templates are soft references from issues and must render as missing
  content rather than throwing.

## Verification

- Focused web Vitest tests for the new tabs and API hooks.
- `bun run check`.
- Manual self-review against PMA-Web and PMA-CR checklists before commit.

## Result

- Implemented the T5b ship detail Equipment and Maintenance frontend scope.
- Project issue detail reference surfacing was intentionally skipped to keep the
  change scoped to `/ships`.
- Verification passed with `bun run check` on 2026-05-24.
