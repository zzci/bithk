# PLAN-029 Project list description and tag spacing restoration

- **status**: completed
- **createdAt**: 2026-05-28 22:35
- **approvedAt**: 2026-05-28 22:35
- **relatedTask**: FIX-007

## Context

Campaign: `l1-cuu89zau-20260528222811`

The target surface is the `/projects` list page:

- `apps/web/src/app/routes/_app/projects/index.lazy.tsx`
- nearby focused tests under `apps/web/src/app/routes/_app/projects/`

Current state:

- `ProjectView` in `apps/web/src/shared/lib/api/projects.ts` exposes
  `description: string | null` and `tags: readonly ProjectTag[]`.
- The list route already searches `p.description`, which confirms the frontend
  expects description data in the existing API contract.
- `ProjectsGrid` currently renders cover image, title/status/settings controls,
  and a tag area only when `project.tags.length > 0`.
- There is no rendered project description in the list card body.
- Because `CardContent` is conditional on tags, cards without tags lose the
  bottom row space and can differ in height/alignment from tagged cards.
- Existing route tests can follow the ships list pattern using
  `renderWithProviders`, mocked `createLazyFileRoute`, mocked navigation, and a
  mocked `fetch`.

## Proposal

Dispatch one focused L3 implementation subtask.

1. Export or otherwise make the projects list page testable using the local
   pattern already used by `ShipsListPage`, if needed.
2. In `ProjectsGrid`, add a concise card body description block in its own
   dedicated row. Render description content only when `project.description`
   has meaningful content, but keep the row model distinct from tags.
3. Always render the bottom tag-row container as a separate dedicated row below
   the description, with a stable minimum height.
   When tags exist, keep the current chips and overflow count behavior. When no
   tags exist, reserve the row visually without adding noisy placeholder copy.
4. Do not merge description and tags into the same line or metadata cluster.
5. Keep click behavior, settings action propagation, tag filtering, and
   pagination behavior unchanged.
6. Add or update focused tests for:
   - a project description appears on the `/projects` card,
   - description and tags occupy separate card rows,
   - a no-tags project still renders the reserved bottom tag-row area using a
     stable test selector or accessible-free structural assertion,
   - tagged projects still render existing tag chips and overflow text.
7. Run focused web tests for the project list, then run `bun run check`.
8. Perform mandatory self-review and fix all P0/P1 findings before reporting
   to L2.

## Risks

- The card itself is clickable and contains an admin settings button; changes
  must not break event propagation or keyboard activation.
- Description text can vary in length, so it should be clamped or otherwise
  constrained to prevent card height blowouts.
- The no-tag reserved space should not introduce visible placeholder copy that
  competes with real tags or changes filtering semantics.
- Full `bun run check` may surface unrelated active-campaign failures; L3 must
  report them clearly instead of widening scope.

## Scope

In scope:

- Project list route/card rendering and focused tests.
- Minimal locale use if an existing translation key is required.
- PMA notes for this campaign.

Out of scope:

- Backend APIs, database schema, project detail tabs, work-order UI,
  procurement UI, global tag schema/backend, broad component refactors,
  dependency changes, and unrelated design changes.

## Verification Plan

- `bun test apps/web/src/app/routes/_app/projects/-project-list.test.tsx`
  or the focused project-list test file L3 creates/updates.
- `bun run check`
- L3 diff self-review focused on acceptance criteria, accessibility,
  responsive card layout, event behavior, and scope control.

## Alternatives

- Backend/API change: rejected unless implementation proves the list endpoint
  omits `description`; current frontend type and search path indicate it is
  already available.
- Render explicit "No tags" text: rejected for now because acceptance asks for
  reserved spacing, not extra visible copy.
- Broader card redesign: rejected because this is a regression fix and should
  stay surgical.

## Annotations

- 2026-05-28 22:35 - Investigation and proposal recorded. The user has
  pre-approved in-scope implementation dispatch for this campaign.
- 2026-05-28 22:40 - L1 supplemental acceptance added: description and tag
  areas must be separate dedicated rows, with empty tag rows still reserving
  vertical space. Forwarded to active L3 `ucxzqk1i`.
- 2026-05-28 22:55 - L2 quality assessment for L3 `ucxzqk1i`: green.
  Logs show the focused project list test passing 5/5 and `bun run check`
  exiting 0. Scope inspection is limited to the project list route, focused
  test, and FIX-007 PMA notes. Because the L3 issue still reports
  `working/running`, the DAG remains green pending BKD auto-review before
  final completion bookkeeping.
- 2026-05-28 23:00 - Completed. L3 `ucxzqk1i` implemented the
  accepted project-list layout fix, strengthened focused coverage for
  row separation, passed focused tests and `bun run check`, and was moved to
  BKD `review`. Simple-mode integration required no branch merge.
