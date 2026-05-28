# PLAN-026 Collapsible project work-order grouped list refinement

- **status**: done
- **createdAt**: 2026-05-28 15:56
- **approvedAt**: 2026-05-28 15:56
- **relatedTask**: UI-018

## Context

The target surface is the project detail work-order tab:

- `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx`
- `apps/web/src/app/routes/_app/projects/-project-issues-tab.test.tsx`

Current state from investigation:

- `PLAN-024/UI-016` already converted the tab from top status filters and
  table/kanban switching to a status-grouped list.
- The component now queries one list per status (`open`, `in_progress`, `done`,
  `cancelled`) and renders each status as a visible section.
- The toolbar currently has search and create only.
- Rows preserve click navigation, priority, assignee, due date, and optional
  pinning.
- The grouped list still uses a bordered `ul` with dividers, so the lower area
  reads heavier than the requested polished list/card-row treatment.
- Existing active work in this repository includes FEAT-015 and UI-017 docs,
  so this plan must avoid unrelated files and tolerate full-check failures
  caused by those campaigns.
- L1 later supplied an additional visual reference:
  `/app/bkd/data/uploads/01KSQMWYV02N2XAJTZEPSHN2A3.png`. Rows should scan
  left-to-right as title / todo item, priority, assignee, and due date.
- L1 later added status grouping rules: hide empty groups after the active
  search/filter is applied; show todo, in progress, pending review, and done
  groups; show a cancelled group only when cancelled rows exist. Current
  frontend/API status enums are `open`, `in_progress`, `done`, and `cancelled`,
  so the implementation must not add schema/API status values in this scope.

## Proposal

Implement a focused refinement in the project work-order tab.

1. Add local collapsible state keyed by `IssueStatus`.
   - Default all groups expanded.
   - Persist state across normal search/filter changes within the mounted tab.
   - Use accessible button headers with `aria-expanded`.
2. Keep statuses as groups, not top status tabs.
   - Keep search and create in the toolbar.
   - Reintroduce only basic toolbar filtering that is not status switching,
     preferably the existing priority filter because the row data already has
     `priority`.
   - Hide any status group whose filtered/search result count is zero.
   - Display status group labels in the requested product order and wording
     where supported by existing data: todo, in progress, pending review, done,
     and cancelled only when there are cancelled items. If pending review cannot
     be represented by the current enum without backend/API changes, document
     that constraint instead of changing schema.
3. Query status groups with the active search and optional priority filter using
   the existing `useProjectIssues` hook.
4. Replace the heavy bordered divided list treatment with lighter compact rows.
   - Use individual subtle row surfaces or soft separators.
   - Keep rows compact, keyboard-focusable, and responsive.
   - Preserve priority, assignee, due date, row navigation, and pin action.
   - Order row content left-to-right as title / todo item, priority, assignee,
     and due date, using aligned metadata zones only as much as needed for
     scanability.
   - Section headers may include collapse affordance, status icon/label/count,
     and an optional create shortcut only if it fits without cluttering the top
     toolbar.
   - Keep visible organization by status groups only. Pinned items may be
     ordered within their status group if useful, but do not render a separate
     pinned section and do not duplicate pinned rows.
5. Update focused Vitest coverage.
   - Collapse and expand a status group.
   - Priority filter changes query behavior without hiding status groups.
   - Search and create controls remain present.
   - Row metadata and practical ordering expectations remain covered.

## Risks

- Querying each status with an additional priority filter keeps the existing
  multi-query shape. It increases no backend surface area but must be mocked
  carefully in tests.
- Collapsed groups should not unmount permanently or lose state during normal
  filter/search changes. Local status-keyed state is sufficient for this
  mounted tab.
- The full quality gate may still be affected by other active campaign changes;
  this task should report that clearly instead of modifying unrelated work.

## Scope

In scope:

- Project work-order/items tab component.
- Focused tests for the same component.
- Direct locale copy only if needed for accessible labels.
- PMA tracking and changelog entry.

Out of scope:

- Backend/API/schema changes.
- Dependency upgrades.
- Global tags FEAT-015.
- Project overview page.
- Unrelated list/table components.

## Verification Plan

- Run the focused project issues tab test.
- Attempt `bun run check`.
- Review UI behavior for keyboard access, visible focus, accessible collapse
  labels, contrast, responsive wrapping, and unchanged row/create/pin behavior.

## Alternatives

- Keep all groups expanded and only lighten styling. Rejected because
  collapsible groups are explicit acceptance criteria.
- Add top status tabs or status filters back into the toolbar. Rejected because
  statuses must remain visible as grouped sections.
- Build a shared collapsible list component. Rejected because this is a focused
  one-surface refinement.

## Annotations

- 2026-05-28 15:56 - Investigation and proposal recorded. The user explicitly
  approved automatic PMA progression for this BKD workflow, so implementation
  can proceed within this scope.
- 2026-05-28 16:03 - L1/user added row-ordering guidance and a second visual
  reference. The active L3 must preserve collapsible status groups and the
  lightweight grouped-list feel while ordering each row as title, priority,
  assignee, and due date.
- 2026-05-28 16:11 - L1/user added status grouping rules: hide empty groups
  after active search/filter, use todo / in progress / pending review / done,
  and include cancelled only when populated. Current code only exposes
  `open`, `in_progress`, `done`, and `cancelled`, so L3 must stay frontend-only
  and report any pending-review data limitation.
- 2026-05-28 16:15 - L1/user clarified pinned behavior: pinned rows may affect
  internal ordering within a status group, but the visible list must not render
  a separate pinned section and must not duplicate pinned items.
- 2026-05-28 16:18 - L3 implementation landed (frontend-only). Status groups are
  now collapsible via `aria-expanded` toggle headers (default expanded, state
  keyed by status). The toolbar gained a priority filter wired into every
  `useProjectIssues` query alongside search and create. Rows were lightened to a
  borderless list with soft hover, ordered title -> priority -> assignee -> due
  date. Empty status groups are hidden and cancelled shows only when populated.
  No separate pinned section was added; existing inline pin and backend row
  ordering are preserved. Data limitation reported: the requested
  todo / in progress / pending review / done taxonomy does not match the backend
  `IssueStatus` enum (`open`, `in_progress`, `done`, `cancelled`); there is no
  pending-review status and adding one is backend/schema work outside this
  frontend-only scope, so the existing four statuses remain. Focused tests (12)
  pass and full `bun run check` is green.
- 2026-05-28 16:18 - Applied the 16:03 row-layout refinement against reference
  `01KSQMWYV02N2XAJTZEPSHN2A3.png`: each row now reads left-to-right as title ->
  priority -> assignee -> due date in a single aligned line (title truncates,
  metadata zone is shrink-stable), replacing the prior stacked title+metadata
  layout while keeping the lightweight borderless grouped feel (no table grid).
  Group order already matches the requested todo / in_progress / (pending
  review) / done / cancelled sequence once the unbacked pending-review slot is
  omitted; empty groups stay hidden, cancelled only when populated; no pinned
  section. Open keeps its existing `issues.status.open` label (the requested
  "todo" relabel and the "pending review" group both need product/backend
  alignment beyond this two-file frontend scope, so they are reported, not
  forced). Focused tests now 13, full `bun run check` green.
- 2026-05-28 16:24 - L1/user added create/edit dialog refinements for the
  active L3: increase dialog width/height within responsive viewport bounds,
  make the description field comfortable for real multi-line writing, keep
  existing fields/actions, improve due-date selection so the calendar/date
  chooser opens directly from the due-date field within the dialog context, and
  add restrained semantic color treatment for assignee/status controls where
  options or states benefit from visual differentiation. If the current local
  date picker primitive cannot provide a richer inline calendar without a
  broader rewrite, L3 should implement the smallest local improvement and
  report the constraint. Focused dialog tests should be updated where practical.
- 2026-05-28 16:27 - L1/user added toolbar placement guidance: the work-order
  search control should move near the top project settings action/header area
  instead of living only in the lower tab-content toolbar. Preserve create and
  basic filters in a coherent top-action arrangement, allow clean wrapping on
  narrow screens, and keep controls visually associated with the top actions.
  The active L3 may make the minimal parent project-detail header change needed
  to place the search beside the existing settings control.
- 2026-05-28 16:29 - L1/user refined top search interaction: place a compact
  search trigger/button/icon near the top settings action, and open a small
  popover/dialog/overlay containing the search input when clicked instead of
  showing a permanently large toolbar input. The same search state must continue
  filtering the grouped work-order list. L1/user also added row layout reference
  `01KSQPBMVJHQRQA2Z2NTM8AFSE.png`: each item should render as a single compact
  row on desktop/tablet, horizontally aligned as title -> priority -> assignee
  -> due date, with wrapping only as a narrow-screen fallback and no heavy table
  grid.
- 2026-05-28 16:30 - L3 completed supported status label rework. Group headers
  now use dedicated `issues.group.*` labels so the work-order tab can show
  Todo / In Progress / Completed / Cancelled without changing shared
  `issues.status.*` labels on other surfaces. L2 accepted this scope decision:
  app-wide taxonomy changes are outside UI-018. L2 reran the focused project
  issues tab test locally and it passed (13 tests). The same L3 was asked to
  continue the remaining queued dialog, search-trigger, and single-row layout
  refinements instead of creating a duplicate subtask.
- 2026-05-28 16:32 - L1/user added create-dialog status control guidance with
  reference `01KSQPGDGNB80RT1YDWX7H12H7.png`: follow the planned large
  title/description area, compact controls row, and sticky footer actions; add a
  status selector beside priority, assignee, and due date; use restrained
  semantic status colors; and use only currently supported statuses. L2 checked
  that `CreateProjectIssueInput` already supports optional `status?: IssueStatus`
  and the current enum is `open | in_progress | done | cancelled`; pending
  review still requires a separate backend/API/schema task.
- 2026-05-28 16:30 - Applied the L2 status-label rework. Added a dedicated
  `issues.group.*` label family (en: Todo / In Progress / Completed / Cancelled;
  zh: 待办 / 进行中 / 已完成 / 取消) and pointed the work-order group headers at
  it via `t("issues.group.${status}")`. The shared `issues.status.*` copy is left
  untouched so the project-overview and ship maintenance/overview surfaces (which
  also read `issues.status.*` and are outside this two-file scope) are not
  disturbed; this keeps the change scoped but means those other surfaces still
  show the old labels until a separate global-taxonomy task rolls them out.
  `pending_review` remains unrepresentable in the current `IssueStatus` enum and
  was not added. Focused tests updated for the new labels (13 pass); full
  `bun run check` green. Note: the 16:24 / 16:27 / 16:29 dialog, top-header
  search, and search-popover items are not part of this label-rework dispatch and
  were not implemented here.
- 2026-05-28 16:45 - Implemented the dialog + search-relocation + status-selector
  dispatch (16:24 / 16:27 / 16:29 / 16:32):
  - Create dialog widened to `sm:max-w-xl` with `max-h` + scroll for small
    screens; description is now `rows={6}` / `min-h-40` resizable; a sticky
    footer keeps Cancel/Create reachable when the body scrolls.
  - Due-date now opens the calendar in one step: a transparent native
    `<input type="date">` overlays a labeled pill, removing the prior
    intermediate dropdown. Constraint: a fully-custom inline calendar would need
    a new Calendar/Popover primitive (none exists) or a new dependency, out of
    scope; the native picker is the smallest local improvement.
  - Added a status selector beside priority/assignee/due-date using the existing
    optional `CreateProjectIssueInput.status`; only supported statuses
    (open/in_progress/done/cancelled) with restrained dot colors from the same
    tokens as the list. Restrained semantic color also added to priority (icon
    tint) and assignee (solid + info-tinted when assigned). `pending_review`
    still omitted (no enum value) and reported.
  - Search moved out of the tab toolbar into a compact icon trigger in the
    project-detail header beside settings (`ProjectIssuesSearch` exported from
    the tab module, placed by `$projectId.lazy.tsx`). Click opens a small
    dropdown-popover with the input; the term is owned by the parent and passed
    to the tab as a `search` prop (still debounced, filters every status group);
    an active-query dot marks a non-empty search.
  - Rows already render as a single left-to-right line; kept as-is.
  - Files: `-project-issues-tab.tsx`, `-project-issues-tab.test.tsx`,
    `$projectId.lazy.tsx`, `locales/en|zh/projects.json`. Focused tests 15; full
    `bun run check` green (a one-off vitest coverage-dir race cleared on rerun).
- 2026-05-28 16:55 - L2 quality assessment passed. L3 logs confirmed the final
  verification pass and the unrelated project overview tab edits belong to a
  separate concurrent campaign. L2 independently reran the focused project
  issues tab suite (15 tests) and full `bun run check`; both passed. UI-018 is
  complete in the shared simple-mode worktree; no branch merge was required.
