# PLAN-053 Tag-filter pinned-chip reliability + projects-home order correction

- **status**: Superseded (replaced by [PLAN-054](PLAN-054.md) unified-filter redesign; FIX-031 was merged into bkd/p57t0zqd @018ffcf and KEPT for issues/procurement, FIX-032 abandoned unmerged)
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

2. **FIX-032** (revised) — On the projects home filter row, the filter CONTROLS
   (标签 selector + pinned common-tag chips + `正常/已归档` status chips) stay on
   the LEFT; only the newly-SELECTED removable × chips are pushed to the RIGHT
   (right-aligned). Achieved by a home-only prop on `ProjectTagFilter` so
   issues/procurement layout stays unchanged. Depends on FIX-031 (same file) —
   serialized.

## Acceptance Criteria

- Pinned common tags appear inline 常驻 at normal desktop width on projects
  home AND issues/procurement tabs (up to 5).
- Responsive shrink still works on genuinely narrow widths.
- Projects-home filter row: selector+pinned+status on the LEFT, selected
  removable × chips right-aligned; issues/procurement layout unchanged.
- `bun run check` passes (web + api tests green); no NEW failure beyond the
  known @milkdown flake and the foreign pagination-footer i18n red.

## Notes

- FIX 1 = `-project-tag-filter.tsx` (+ `.fit.ts` + tests). FIX 2 =
  `index.lazy.tsx` filter row. Different files → 2 parallel L3s.
