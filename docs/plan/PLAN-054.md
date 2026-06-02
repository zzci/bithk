# PLAN-054 Generic unified "筛选" filter component + projects-list adoption

- **status**: Planned
- **owner**: l1-75ymcfnr / L2 p57t0zqd
- **campaignId**: l1-75ymcfnr-tagpos-20260602063716
- **tasks**: [FIX-033](../task/FIX-033.md)
- **createdAt**: 2026-06-02
- **supersedes**: [PLAN-053](PLAN-053.md)

## Goal

Build a generic, reusable unified filter component and adopt it on the projects
LIST, fixing the pinned-chip flicker / 非常驻 bug architecturally by removing the
ResizeObserver pinned-fit logic from the projects-list filter path entirely.

### Generic component

`apps/web/src/shared/components/list-filter.tsx` (clean name/location consistent
with the codebase). Unifies status + tags (extensible to priority/category) into
ONE control:

- Props: a list of filter DIMENSIONS. Each dimension =
  `{ key, label, mode: "single"|"multi", options: Array<{value,label,count?}>,
  value, onChange }`. Generic — not hardcoded to status or tags. Use a
  discriminated union on `mode` so single/multi value+onChange types are exact.
- Declarative RESIDENCY (常驻): a dimension may declare `resident: true` (whole
  group inline as always-visible toggle chips) and/or `residentCount: N` (first N
  options inline, remainder in dropdown). Resident toggles are click-to-filter,
  highlighted when active (aria-pressed), ALWAYS shown — NO ResizeObserver / NO
  width-fit math (flicker-free), NO ×.
- A SINGLE 筛选 (Filter) trigger Button → dropdown listing only the NON-resident
  remainder, grouped by dimension (section labels + aria-checked + optional
  counts). Trigger hidden when no remainder.
- Selecting a NON-resident option → removable × chip to the RIGHT. Resident
  toggles convey state by highlight (no ×). Residency is DECLARATIVE config, not
  measured — do NOT reintroduce `-project-tag-filter.fit.ts`.
- Accessible: trigger = real Button; chip remove = real Button with aria-label;
  dropdown items proper roles/aria-checked.
- i18n en/zh parity for new strings (筛选/Filter, dimension labels reuse existing
  keys where possible: status.active/archived, list.tagFilterMore="Tags").

### Adoption (projects list)

`apps/web/src/app/routes/_app/projects/index.lazy.tsx`: replace
[ProjectTagFilter + separate 正常/已归档 status chips] with the new component, two
dimensions:
- 状态 (status): single-select, `resident: true` (whole group inline toggles),
  正常(active)/已归档(archived) + counts, default 正常.
- 标签 (tags): single-select, `residentCount: 5` (top-5 most-used tags pinned
  inline as toggle chips, always shown; rest in 筛选 dropdown; non-resident
  selected → removable × chip).
Behavior must match today; 常用标签常驻 restored; flicker/非常驻 bug GONE
(declarative residency, not measured).

## Scope / Constraints

- Build the generic component + adopt on projects LIST only.
- Issues/procurement KEEP their current ProjectTagFilter (a later campaign may
  migrate them). Do NOT remove ProjectTagFilter from issues/procurement.
- `-project-tag-filter.fit.ts(.test)` is still used by ProjectTagFilter
  (issues/procurement) → KEEP it.
- Concurrent overlap: REFACTOR-012 (shared toolbar-filter) is in progress — build
  independently/self-contained; do not depend on their in-progress files. The
  main `check:i18n` red (pagination-footer.tsx procurement.total) is theirs, not
  ours; add no NEW failure.

## Note on FIX-031

FIX-031 (ancestor-width measurement for ProjectTagFilter) was merged into
bkd/p57t0zqd @018ffcf BEFORE the redesign hold. It is KEPT because
issues/procurement still use ProjectTagFilter and benefit from the fix. Flagged
to L1 for awareness; revert only if L1/user wants the branch to exclude it.

## Acceptance Criteria

- Generic ListFilter renders one 筛选 button; options grouped by dimension with
  selected state + counts; selected items as removable × chips on the right.
- Projects list: status (active/archived) + tag filtering work as before; no
  flicker; no ResizeObserver pinned-fit on this path.
- a11y (Button trigger, aria-label removes, aria-checked items); i18n en/zh
  parity.
- `bun run check` passes (web + api tests green); only the known foreign
  pagination-footer i18n red remains; no NEW failure.

## Decomposition

1 L3 (FIX-033): generic component + projects-list adoption + i18n + tests
(tightly coupled → single worktree to avoid API mismatch).
