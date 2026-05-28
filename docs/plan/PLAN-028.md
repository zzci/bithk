# PLAN-028 Project overview list polish

- **status**: done
- **createdAt**: 2026-05-28 16:40
- **approvedAt**: 2026-05-28 16:40
- **relatedTask**: UI-019

## Context

The target surface is the project overview tab:

- `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx`
- `apps/web/src/app/routes/_app/projects/-project-overview-tab.test.tsx`

Current state:

- `ProjectOverviewTab` loads latest work orders with `useProjectIssues(project.id, { limit: 5 })`.
- `ProjectOverviewTab` loads latest procurements with `useProcurements(project.id, { limit: 5 }, caps.canViewProcurement)`.
- `ProjectPinnedCard` loads mixed pinned issue/procurement rows with `usePinnedItems(projectId)`.
- The UI-017 metadata simplification is already present as one compact
  `ProjectInfoCard` and should stay intact.
- Pinned rows and latest activity rows preserve navigation through
  `onOpenTab("issues" | "procurement")`.
- Procurement overview content remains permission-gated by
  `caps.canViewProcurement`.
- Current list loading and empty states render as plain text in card content,
  and rows use minimal spacing and metadata hierarchy.

## Proposal

Implement only the overview list polish.

1. Keep `ProjectInfoCard` intact except for a tiny spacing adjustment only if
   needed after list changes.
2. Introduce local presentational helpers inside
   `-project-overview-tab.tsx` for intentional list states and row layout.
   Do not add dependencies or shared primitives.
3. Update pinned item rows to improve hierarchy:
   - title remains the primary line
   - type/status/date metadata align consistently
   - disabled procurement rows remain non-navigable when permissions do not
     allow opening procurement
   - responsive wrapping avoids cramped badges on narrow screens
4. Update latest work-order and procurement rows to use the same row rhythm and
   aligned metadata treatment while preserving existing click targets.
5. Replace loose loading/empty copy placement with compact muted list-state
   blocks inside each card.
6. Update focused tests for pinned list rendering, latest-list navigation, and
   empty states. Keep the existing assertion that removed summary metrics do
   not return.
7. Dispatch the implementation to one L3 issue with `engineType="claude-code"`.
   L3 must self-review, run focused verification, attempt `bun run check`, and
   report back to L2 without dispatching or merging.

## Risks

- The overview already has concurrent nearby campaigns touching project issue
  tabs and detail behavior. This work must avoid those files.
- Tests must distinguish retained list labels from the removed summary metric
  labels.
- Full `bun run check` may fail because other active campaigns currently have
  uncommitted work in the repository; unrelated failures should be reported,
  not fixed.

## Scope

In scope:

- Project overview tab list sections for pinned items, latest work orders, and
  latest procurements.
- Direct focused overview tab tests.
- Direct overview locale copy only if required for loading/empty state clarity.
- PMA tracking and changelog completion notes.

Out of scope:

- Backend APIs, database schema, work-order tab refinement, issue detail
  migration, global tags, right-side summary/metric cards, broad design-system
  changes, dependency upgrades, and unrelated project pages.

## Verification Plan

- Run the focused project overview tab test, for example:
  `bun test apps/web/src/app/routes/_app/projects/-project-overview-tab.test.tsx`
- Run a diff self-review focused on behavior preservation, accessibility,
  responsive layout, and scope control.
- Attempt `bun run check`; report unrelated active-campaign failures clearly.

## Alternatives

- Rework the entire project overview into a new layout. Rejected because the
  previous metadata simplification is approved and should remain intact.
- Change data limits, backend sorting, or APIs. Rejected because the request is
  visual/list polish only.

## Annotations

- 2026-05-28 16:40 - Investigation and proposal recorded. Automatic execution
  is enabled for this BKD campaign, so implementation dispatch may proceed.
- 2026-05-28 16:45 - Implemented by L3 y6g7h96j. Added local `ROW_BUTTON_CLASS`,
  `RowMeta`, and `ListState` helpers; pinned and latest rows now scan title-first
  with a wrapping aligned metadata line; loading/empty states are intentional
  centred muted blocks. Metadata card and removed summary tiles untouched. Six
  focused tests added (overview suite 15/15); `bun run check` green. Done.
