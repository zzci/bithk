# PLAN-020 — Projects Content-Page Parity With Current APIs

- **status**: completed
- **createdAt**: 2026-05-25 16:00
- **approvedAt**: 2026-05-25 16:00
- **completedAt**: 2026-05-25 16:45
- **relatedTask**: UI-004

## Context

`PLAN-019` identifies Projects parity gaps against the rendered prototype. Current frontend APIs cover project list/detail, members, roles, issues, procurement categories, procurements, contacts, and visible users. Backend-gated fields such as ship context, file counts, owner display, issue hours/materials/approval/checklist fields, procurement ETA/unit/unit-price/urgent/requisition/import, supplier preview, and recent activity remain unavailable.

L1 approved one shared hook edit: update `apps/web/src/shared/lib/api/procurement.ts` so procurement list query keys include `limit` and other query params, allowing count-only queries without colliding with list cache entries.

## Proposal

- Restyle `apps/web/src/app/routes/_app/projects/index.lazy.tsx` with denser cards and a frontend grid/list toggle using only current project fields.
- Restyle `$projectId.lazy.tsx` as a breadcrumb-style hero, preserve settings/delete gating and issue drawer `Outlet`, and add a Members tab.
- Add `-project-members-tab.tsx` backed by `useProjectMembers` and `useProjectRoles`.
- Extend overview with procurement category preview from `useProcurementCategories`.
- Extend issues with status chips and a status-based kanban toggle over existing issue statuses.
- Update procurement cache keys, then add current-API stage count/amount summary and keep the existing paginated list behavior.
- Add focused Vitest coverage and a new Playwright route spec using `tests/fixtures/projects.ts`.

## Risks

- Cache-key changes must preserve existing invalidation through `procurementKeys.byProject`.
- Count queries must not replace paginated list data in TanStack Query.
- UI must not imply backend-gated fields exist.

## Scope

Allowed implementation files are the Projects route directory, project locale files, the approved procurement shared hook, and new/adjusted tests.

## Alternatives

- Running N+1 detail queries on the list was rejected because `PLAN-019` explicitly escalates list aggregate counts.
- Mocking prototype-only fields was rejected because the task requires current-API-backed parity only.

## Annotations

- User approved implementation after the proposal and later approved the procurement cache-key exception.
- E2 procurement cache-key fix was applied by keying list queries on the full query string.
- Focused Vitest, Playwright route coverage, and `bun run check` passed.
