# PLAN-063 Project overview description+pinned grid 2:1 responsive ratio

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 to81pc78
- **campaignId**: l1-75ymcfnr-ovratio-20260603200526
- **tasks**: [UI-023](../task/UI-023.md)
- **createdAt**: 2026-06-03

## Goal

A prior change ([PLAN-059](PLAN-059.md)/[UI-022](../task/UI-022.md)) placed the
description card and the pinned card side-by-side in `grid gap-4 lg:grid-cols-2`
(~line 46 of `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx`)
= equal 1:1 columns. Change the top grid row to a responsive ratio:

- **small (base)**: single column, stacked — `grid-cols-1`.
- **medium**: 1:1 — two equal columns — `md:grid-cols-2`.
- **large**: 2:1 — the description column is twice the pinned column.
  Implement via `lg:grid-cols-3` with the DESCRIPTION card spanning
  `lg:col-span-2` and the pinned card `lg:col-span-1`.

## Current layout

`-project-overview-tab.tsx:46`:
`<div className="grid gap-4 lg:grid-cols-2">` wrapping `ProjectInfoCard`
(description) then `ProjectPinnedCard` (pinned). The latest-issues /
latest-procurements grid row below it (line ~51) is a separate, unrelated wrapper.

`ProjectInfoCard` and `ProjectPinnedCard` each render a single shadcn `<Card>` as
the direct grid child. The `<Card>` forwards `className` via `cn()`
(`apps/web/src/shared/components/ui/card.tsx`), so the `col-span` utility must be
applied to that Card (via a new optional `className` prop), not a wrapper div.

## Scope / Constraints

- ONLY `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx`.
  The test `…/-project-overview-tab.test.tsx` does NOT assert grid/col-span
  classes, so it needs no change — leave it unless a class change breaks it.
- No backend, no shared components, no i18n.
- Change the top grid wrapper from `grid gap-4 lg:grid-cols-2` to
  `grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3`.
- Add an optional `readonly className?: string` prop to `ProjectInfoCard` and
  `ProjectPinnedCard`, forwarding it onto their `<Card>` via `cn(...)`.
- Pass `className="lg:col-span-2"` to `ProjectInfoCard` and
  `className="lg:col-span-1"` to `ProjectPinnedCard` in the wrapper.
- Keep the cards' content, the pinned-row markup, the latest-activity grid row,
  loading/empty/error states, view-all, and per-row navigation unchanged.
- Coordination: a concurrent campaign (gtag) may also touch this file (tag
  display migration). Keep the diff minimal & localized to the grid wrapper +
  the two cards' `className` prop/forwarding; L1 resolves any merge conflict.
- Dev phase: breaking changes OK.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown/ctx
  teardown flake (exit1 with 0 real test failures).

## Acceptance Criteria

- Top grid wrapper is `grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3`.
- Description card carries `lg:col-span-2`; pinned card carries `lg:col-span-1`
  (so on `lg` description is twice as wide as pinned; on `md` they are equal;
  on small they stack).
- `ProjectInfoCard` / `ProjectPinnedCard` accept an optional `className` merged
  onto their `<Card>`.
- Card content, pinned rows, and the latest-activity grid row below are unchanged.
- `bun run check` EXIT=0 (modulo the @milkdown flake).

## Decomposition (1 L3)

1. **L3-1 frontend** — edit `-project-overview-tab.tsx`: top grid wrapper ratio
   + `className` prop on the two card components + col-span pass-through. Run
   `bun run check`. Update the test only if a class change actually breaks it.
