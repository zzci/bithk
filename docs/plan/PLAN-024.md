# PLAN-024 Status-grouped project work-order list

- **status**: completed
- **createdAt**: 2026-05-28 15:09
- **approvedAt**: 2026-05-28 15:09
- **completedAt**: 2026-05-28 15:47
- **relatedTask**: UI-016

## Context

The target surface is the project detail work-order tab:

- `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx`
- `apps/web/src/app/routes/_app/projects/-project-issues-tab.test.tsx`
- project-module locale copy under `apps/web/src/locales/*/projects.json`

Current state:

- The tab uses `useProjectIssues` for a filterable paginated issue list.
- The top area includes status filter chips, a priority filter, and a list /
  kanban view switch.
- The list branch renders a table. The kanban branch renders status columns,
  but it is behind a view-mode switch and uses card-like items.
- Existing project-module copy intentionally labels project issues as work
  orders. The shared/global issue namespace already uses "事项" in Chinese, so
  this plan keeps terminology changes local and minimal.
- The latest L1/user correction requires the grouped status-list direction and
  supersedes the temporary single-list request.
- The reference image points to a compact list pattern: status headers with
  counts, list rows, subdued metadata, and no top status switching.

## Proposal

Implement only the project work-order tab changes.

1. Replace top status chips, priority select, and list/kanban toggle with one
   toolbar containing search and the create action.
2. Query each status group directly with the current search term so all statuses
   remain visible without a status filter. Use the existing `useProjectIssues`
   hook and avoid backend/API changes.
3. Render a single vertical grouped-list surface:
   - groups for `open`, `in_progress`, `done`, and `cancelled`
   - visible translated status labels and counts from each query's `meta.total`
   - compact button rows that open the issue detail route
   - priority, assignee, due date, and pin action preserved where applicable
4. Keep copy scoped:
   - prefer current project-module work-order labels unless a localized generic
     create label is already clearly appropriate
   - keep the toolbar create action as the existing project work-order action
     unless implementation review shows the module already uses item wording
5. Update focused tests:
   - remove assertions for status filters and view-mode switching
   - add assertions for grouped headers/counts, search, create, navigation, and
     pin behavior
6. L2 will dispatch the implementation to one L3 issue using `engineType` set
   to `claude-code`. L3 must self-review and report back; L2 will verify and
   run `bun run check` before final completion.

## Risks

- Querying per status increases requests from the tab. This stays scoped to the
  existing API and matches the need for independent group counts without adding
  backend aggregation.
- Very large status groups may still need future per-group pagination or
  collapsing. That is out of scope for this UI pass.
- Unit tests mock fetch broadly; they must be updated carefully so they still
  validate behavior rather than implementation order.

## Scope

In scope:

- Project work-order tab component, focused tests, directly needed project
  locale keys, and PMA/changelog tracking.

Out of scope:

- Backend semantics, database schema, unrelated tabs/pages, global navigation
  rename, broad issue/work-order terminology migration, dependency upgrades,
  and shared design-system rewrites.

## Verification Plan

- Run the focused project issues tab test.
- Run `bun run check` after integration.
- Perform a UI/accessibility self-review for keyboard row activation, pin
  buttons, visible focus states, empty/loading/error states, contrast, and
  mobile wrapping behavior.

## Alternatives

- Keep the table and remove filters only. Rejected because it does not match the
  status-grouped reference direction.
- Use the existing kanban mode as the default. Rejected because the requested
  result is compact and list-like, not card-heavy.
- Rename all project work-order copy to "事项". Rejected for now because the
  latest guidance asks not to force a broad rename and the project module
  already consistently uses work-order language.

## Annotations

- 2026-05-28 15:09 - Investigation and proposal recorded. Automatic approval is
  active for the corrected L1 scope, so implementation dispatch may proceed.
- 2026-05-28 15:33 - L3 `eoj655gs` completed successfully and was merged into
  `main` as a no-conflict worktree merge. Focused verification passed after
  merge. The repository-wide `bun run check` currently fails during API
  typecheck because the active FEAT-015 typed-tags work imports `tags` from the
  project schema while that symbol is not exported there. This plan remains
  implementing until the external quality-gate blocker is cleared and the full
  gate can be rerun.
- 2026-05-28 15:34 - Follow-up wake reran `bun run check`; it still fails on
  the same FEAT-015 API typecheck errors. The status-grouped work-order list
  remains integrated and focused verification remains green.
- 2026-05-28 15:47 - The external FEAT-015 blocker was resolved on `main`.
  `bun run check` passed, so this plan is completed.
