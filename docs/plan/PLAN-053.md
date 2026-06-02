# PLAN-053 Tag-filter pinned-chip reliability + projects-home order correction

- **status**: Planned
- **owner**: l1-75ymcfnr / L2 p57t0zqd
- **campaignId**: l1-75ymcfnr-tagpos-20260602063716
- **tasks**: [FIX-031](../task/FIX-031.md), [FIX-032](../task/FIX-032.md)
- **createdAt**: 2026-06-02

## Goal

Two related corrective fixes on the projects tag filter, following the
regression introduced by PLAN-052 (FIX-028) responsive pinned-chip count and the
ordering set by FIX-030.

1. **FIX-031 (primary)** — Pinned "common tags" no longer show reliably at
   normal desktop widths. The `ResizeObserver` in `-project-tag-filter.tsx`
   measures the component's own `rowRef` div, which is a shrinkable flex item
   (`flex min-w-0 flex-wrap`) sharing the row with status chips and search. The
   measured width is far smaller than the real available width, so
   `pinnedFitCount` returns 0 and no pinned chips appear. Requirement: the top-N
   most-used tags (up to `PINNED_COUNT=5`) must reliably show inline at normal
   widths; only genuinely narrow/overflow should shrink or drop pinned chips.

2. **FIX-032** — On the projects home filter row, the `正常/已归档` status-chip
   group must come FIRST and `<ProjectTagFilter>` must render to their RIGHT
   (reversing FIX-030, which moved the tag filter to the front). Projects home
   only; issues-tab order unchanged.

## Acceptance Criteria

- Pinned common tags appear inline 常驻 at normal desktop width on projects
  home AND issues/procurement tabs (up to 5).
- Responsive shrink still works on genuinely narrow widths.
- Projects-home filter row order: status chips first, then tag filter.
- `bun run check` passes (web + api tests green); no NEW failure beyond the
  known @milkdown flake and the foreign pagination-footer i18n red.

## Notes

- FIX 1 = `-project-tag-filter.tsx` (+ `.fit.ts` + tests). FIX 2 =
  `index.lazy.tsx` filter row. Different files → 2 parallel L3s.
