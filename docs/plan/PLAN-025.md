# PLAN-025 Project overview metadata layout simplification

- **status**: completed
- **createdAt**: 2026-05-28 15:42
- **approvedAt**: 2026-05-28 15:42
- **completedAt**: 2026-05-28 15:58
- **relatedTask**: UI-017

## Context

The target surface is the project overview tab:

- `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx`
- `apps/web/src/app/routes/_app/projects/-project-overview-tab.test.tsx`

Current state:

- `ProjectOverviewTab` loads latest work orders with `useProjectIssues` and
  latest procurements with `useProcurements`, preserving the existing permission
  gate through `caps.canViewProcurement`.
- The top `ProjectSummaryCard` renders creator, last updated time, tags, and
  right-side metrics for work orders and procurement counts.
- `ProjectDescriptionCard` renders the description as a separate card below the
  summary card.
- The later pinned card and latest work-order/procurement cards are separate
  useful lists and should remain.
- The existing focused test includes a metric-count assertion that should be
  replaced with coverage for the unified information section and removed
  summary metrics.

## Proposal

Implement only the overview-tab layout simplification.

1. Replace the separate summary and description cards with one compact project
   information card/section.
2. Keep creator and last updated metadata in a responsive row, keep tags below
   or beside that metadata using the existing badge style, and render the
   description in the same card with the existing empty state.
3. Remove `SummaryMetric` and its right-side work-order/procurement metric
   rendering from the overview tab.
4. Preserve the existing latest work-order and procurement queries because the
   latest-list cards still need them. Do not remove pinned item loading,
   permissions, latest lists, row click behavior, or dialogs.
5. Update focused tests:
   - assert creator, updated date, tags, and description are in one project
     information region/card
   - assert metric labels/counts from the old summary are absent
   - keep coverage for pinned content, latest list navigation, procurement
     permission gating, and description empty state
6. Dispatch the implementation to one L3 issue with `engineType="claude-code"`.
   L3 must self-review, run focused verification, attempt `bun run check`, and
   report back to L2 without merging or further dispatching.

## Risks

- The words "Work orders" and "Procurement" also appear in pinned kind badges
  and latest-list headings. Tests must distinguish removed summary metrics from
  retained useful list content.
- Removing metrics should not remove the underlying queries because list
  rendering still depends on them.
- The repository currently has an unrelated FEAT-015 API typecheck blocker.
  Full `bun run check` may remain red for that reason only.

## Scope

In scope:

- Project overview tab component, focused overview tab tests, directly needed
  project overview locale copy, PMA tracking, and changelog completion notes.

Out of scope:

- Backend APIs, schema, work-order/procurement modules, global tag backend work,
  unrelated overview/list pages, dependency upgrades, and broad UI refactors.

## Verification Plan

- Run the focused project overview tab test.
- Run a diff self-review focused on layout, retained behavior, accessibility,
  and scope.
- Attempt `bun run check`; report the known FEAT-015 blocker if it remains the
  only failure.

## Alternatives

- Remove all latest work/procurement content. Rejected because the acceptance
  criteria explicitly preserve useful latest lists unless they are the
  right-side summary/metric content.
- Keep description as a separate card and only remove metrics. Rejected because
  the goal is a unified project information block.

## Annotations

- 2026-05-28 15:42 - Investigation and proposal recorded. Automatic approval is
  active for this BKD campaign, so implementation dispatch may proceed.
- 2026-05-28 15:58 - L3 `et2xts0s` passed logs-filter quality assessment and
  was merged into `main`. Focused overview test verification passed. Full
  `bun run check` passed after integration; the previously known FEAT-015
  typecheck blocker was not present.
