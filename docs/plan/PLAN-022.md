# PLAN-022 Project overview hierarchy polish

- **status**: completed
- **createdAt**: 2026-05-28 14:43
- **approvedAt**: 2026-05-28 14:45
- **completedAt**: 2026-05-28 15:02
- **relatedTask**: UI-015

## Context

The project detail route is `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx`.
It owns the compact title row, line tabs, settings/delete dialogs, and tab
composition. The overview tab itself is
`apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx`.

Current overview state:

- The route fetches project detail, members, visible users, issue count, and
  procurement count. Members are still needed by issue/procurement assignee
  controls, even though members are no longer an overview tab.
- The overview tab fetches pinned items, latest issues, and latest procurement
  records. It renders a plain vertical sequence: metadata, separator,
  description, pinned list, latest work orders, and latest procurements.
- Project tags, creator, last update, description, pinned items, and latest
  activity are present, but the hierarchy reads flat because only the page title
  and tab rail are strong visual anchors.
- Latest and pinned rows are single-line flex rows with title, badge, and date.
  They truncate titles, but on narrow screens multiple right-side items can
  crowd the title.
- Existing project conventions prefer shadcn/base-nova primitives, Tailwind
  semantic tokens, lucide icons, compact internal-tool density, and restrained
  work-focused layouts. The ship overview already uses a two-column card
  layout, `Card`, small section headers, icon metric tiles, and dense bordered
  rows as the closest local precedent.
- `docs/design/project-detail-redesign.md` documents the prior redesign contract.
  This task is a follow-up polish pass, not a rollback to the earlier hero-card
  layout.

## Proposal

Redesign only the overview surface while keeping the existing route shell and
data hooks.

1. Keep the project detail route structure intact: back action, compact title
   row, promoted line tabs, settings/delete dialogs, and files/issue/procurement
   tab composition.
2. Rebuild `ProjectOverviewTab` into a restrained dashboard layout:
   - A top metadata card with creator, last update, tags, and compact metric
     tiles for work orders and procurement when visible.
   - A description/brief card that gives the project description a clearer
     label and bounded reading measure.
   - A pinned-work card that preserves the mixed issue/procurement list but
     uses clearer row affordances and stronger empty/loading states.
   - A recent-activity area that groups latest work orders and latest
     procurements in separate cards. On desktop they may sit in two columns
     when procurement is visible; on mobile they stack.
3. Adjust row layout for responsive scanning:
   - Keep title as the dominant text.
   - Move status/date metadata into a wrapping secondary line where needed so
     badges do not squeeze long titles on mobile.
   - Preserve keyboard focus rings, button semantics, and tab-switch behavior.
4. Reuse existing primitives and tokens only: `Card`, `Badge`, `Button`,
   existing status color maps, `formatDate`, and lucide icons already available.
   No new dependencies, no global CSS, and no new shared primitive unless the
   implementation proves a tiny local helper reduces duplication inside the
   overview file.
5. Update focused tests for the new grouping and responsive-safe semantics.
   Existing behavior tests should continue to assert description, creator/tags,
   pinned mixed rows, empty state, tab switching, and procurement capability
   gating.

Implementation decomposition after approval:

- L3-A: Implement the overview layout polish and focused test updates in
  `-project-overview-tab.tsx` and its test.
- L3-B: Run verification and make any small route-shell or locale/test
  adjustments needed by the approved layout, then self-review the diff.

The layout implementation completed in one focused worktree branch. Final
integration verification and the repository quality gate were run on `main`.

## Risks

- The overview already has coverage around text and interactions; changing
  headings or row structure may require careful test updates to avoid weakening
  behavior assertions.
- Duplicating card/list helpers inside the overview could add local complexity.
  Keep helpers small and file-local.
- The route prefetches count queries and the overview fetches latest lists.
  This plan does not alter query behavior, so it will not reduce network calls.
- Visual polish cannot be fully validated by unit tests. If a browser check is
  needed after implementation, the dev server must run through the repository
  tmux workflow.

## Scope

In scope:

- Project overview route/component surface.
- Directly used overview row/card helpers in the same file.
- Focused tests and i18n keys only if labels change.
- Minimal PMA task/plan/changelog updates.

Out of scope:

- Backend APIs, database/storage schema, auth/user flows, unrelated project
  tabs, global design-system rewrites, dependency upgrades, and broad project
  module refactors.

## Verification Plan

- Run focused web tests for the project overview component during L3 work.
- Run `bun run check` after integration.
- Perform an accessibility self-review for headings, focus-visible states,
  button labels, color-not-only status indicators, loading/empty states, and
  mobile wrapping behavior.
- If visual verification is needed, run `bun run dev` in the required tmux
  session and inspect desktop/mobile rendering.

## Alternatives

- Reintroduce a large cover/hero card. Rejected: recent project direction
  intentionally moved the route to a compact working surface.
- Change backend APIs to provide richer summary data. Rejected: the request is
  UI hierarchy and layout only.
- Create a shared overview dashboard component. Rejected for now because only
  this project overview needs the polish and a shared abstraction would exceed
  the requested scope.

## Annotations

- 2026-05-28 14:43 - Investigation and proposal prepared. Waiting for explicit
  approval before implementation.
- 2026-05-28 14:45 - Approval received. Plan moved to implementing.
- 2026-05-28 14:48 - Automatic continuation approved for later tasks within
  the already approved project overview UI polish scope. Escalation remains
  required for scope changes, unrelated/destructive changes, repeated red
  failures, or decisions outside this proposal.
- 2026-05-28 15:02 - Completed. Worktree implementation was integrated into
  `main`; a post-merge test wait issue was fixed; `bun run check` passed.
