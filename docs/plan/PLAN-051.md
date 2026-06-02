# PLAN-051 Tag-filter responsive pinned-chip count

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 xgbm1bkf
- **campaignId**: l1-75ymcfnr-tagfit-20260602054625
- **tasks**: [FIX-028](../task/FIX-028.md), [FIX-029](../task/FIX-029.md), [FIX-030](../task/FIX-030.md)
- **createdAt**: 2026-06-02

## Goal

Make the pinned tag chips in the shared `ProjectTagFilter`
(`apps/web/src/app/routes/_app/projects/-project-tag-filter.tsx`, used by the
issues tab, procurement tab, and projects home) RESPONSIVE to the available
container width. Today a fixed `PINNED_COUNT = 5` most-used tags pin as inline
toggle chips and the rest feed the "标签" selector. Change it so the number of
pinned chips ADAPTS to width: when the row narrows, drop the least-important
pinned chips (keep the most-used first), down to 0 when there is no room;
`PINNED_COUNT = 5` stays the MAX when wide. Any most-used tag that doesn't fit
falls into the "标签" dropdown like the other non-pinned tags — nothing is lost.

Public props stay UNCHANGED so the three consumers need no edits.

## Approach

1. **Measure container width** with a `ResizeObserver` on the wrapper element
   (ref). Compute how many of the top-5 pinned chips fit, reserving room for the
   always-present "标签" selector trigger plus any removable selected chips.
2. **Recompute on resize.** Keep an effective pinned count in state, clamped to
   `[0, min(5, tags.length)]`.
3. **Split** `pinned = tags.slice(0, fitCount)`, `rest = tags.slice(fitCount)`.
   The dropdown/combobox already lists `rest` (now including any top-5 tag that
   didn't fit) minus selected; everything else is unchanged.
4. A small local fit helper (reintroducing the minimal idea of the deleted
   `-project-tag-filter-logic.ts`) computes the count from a measured width and
   per-chip width estimates. Keep it minimal and unit-TESTED.
5. **SSR / no-ResizeObserver / unmeasured (width 0) fallback:** render up to the
   MAX (5, clamped to tag count) without crashing. This keeps jsdom tests (which
   have no layout) rendering all 5 pinned chips as today.

## Constraints

- Pinned chips stay highlight toggles, NO × (not removable).
- Dropdown lists the non-pinned rest (now including pinned-but-didn't-fit ones);
  non-pinned selected render as removable × chips; trigger stays neutral.
- Public props/signatures UNCHANGED; all 3 consumers compile untouched.
- i18n en/zh parity if any new string is introduced.

## DAG

Three independent lanes (different files) → all parallel, no shared-file
conflict.

- FIX-028 deps=[] / L3 — sole owner of `-project-tag-filter.tsx`,
  optional `-project-tag-filter.fit.ts` (or inline helper) + its test, the
  component test `-project-tag-filter.test.tsx`, and any new `list.tagFilter*`
  keys in `locales/{en,zh}/projects.json`. Responsive pinned-chip count.
- FIX-029 deps=[] / L3 — sole owner of `-project-issues-tab.tsx` (issues
  toolbar): tag filter to front + remove visible "按标签筛选" label; may touch
  `locales/{en,zh}/projects.json` ONLY if `issues.tagFilter` becomes unused.
- FIX-030 deps=[] / L3 — sole owner of `index.lazy.tsx` (home filter row): move
  tag filter before the 正常/已归档 status chips.

i18n note: FIX-028 and FIX-029 could both touch `projects.json`. FIX-028 likely
adds no key; FIX-029 only edits the key if it becomes fully unused (it stays
referenced by the group `aria-label`, so likely NO json edit). If both end up
editing json, merge FIX-028 first, then FIX-029 rebases — but in practice
neither is expected to write json.

## Acceptance Criteria

- Pinned chip count adapts to measured container width: narrower → fewer pinned
  (most-used kept first), down to 0; max 5 when wide.
- Tags dropped from pinned because they didn't fit appear in the "标签"
  dropdown/combobox (minus selected); nothing is lost.
- Fit helper is unit-tested (width + reserve → count, clamped to `[0, 5]`).
- SSR / no-ResizeObserver / width-0 fallback renders up to max (5, clamped to
  tag count) without crashing; existing jsdom tests still pass.
- Pinned chips remain highlight toggles (aria-pressed, no ×); dropdown trigger
  neutral; non-pinned selected remain removable × chips.
- Public props UNCHANGED; 3 consumers compile untouched.
- i18n en/zh parity for any new string.
- `bun run check` exits 0 (`@milkdown/ctx` teardown flake in
  `-project-issue-panel.test.tsx` is KNOWN — grep to confirm before treating a
  test exit 1 as real; `bun install` first if a fresh worktree errors 127).

## Out of Scope

- Only the tag-filter component (+ optional small fit helper + tests + i18n).
  No consumers' source, no backend, no other behavior changes.

## Notes

- 2026-06-02 - Created at L2 xgbm1bkf bootstrap.
- 2026-06-02 - All 3 L3 lanes (FIX-028 allpuvtd / FIX-029 e0xamx5y / FIX-030 pt67mhzv) merged --no-ff into bkd/xgbm1bkf; no file overlap, clean merges. `bun run check` exit 1 = KNOWN @milkdown/ctx teardown flake only (web 621/621 pass, changed-file tests 47/47 green). PLAN Completed; branch ready for L1 review+merge.
