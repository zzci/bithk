# PLAN-048 Tag-filter polish + projects-home label removal

- **status**: In Progress
- **owner**: l1-75ymcfnr / L2 h9ieukwl
- **campaignId**: l1-75ymcfnr-tagfx-20260602025356
- **tasks**: [FIX-024](../task/FIX-024.md), [FIX-025](../task/FIX-025.md)
- **createdAt**: 2026-06-02

## Goal

### A — Tag-filter polish (FIX-024)

Three tweaks to the redesigned `ProjectTagFilter`
(`apps/web/src/app/routes/_app/projects/-project-tag-filter.tsx`):

1. **Neutral trigger.** The selector trigger must never switch to the
   highlighted/active (filled `default`/`primary`) variant when tags are
   selected. Selection is already conveyed by the removable chips, so the
   trigger stays NEUTRAL (outline) regardless of how many tags are selected, in
   both multi-select (issues/procurement combobox) and single-select (projects
   home dropdown) modes.
2. **Exclude selected from the list.** The dropdown/combobox list must list only
   UNSELECTED tags — already-selected tags (shown as chips outside) must not also
   appear in the list. Applies to both modes. Edge case: when every tag is
   selected / none remain, show a graceful empty / "no more tags" state (new
   `list.tagFilterNoMore`, en+zh).
3. **Rename trigger label.** The trigger reads "更多"/"More" (left over from the
   old overflow control); after the redesign it IS the tag picker, so rename to
   "标签"/"Tags" (value of `list.tagFilterMore` + the aria-label
   `list.tagFilterMoreLabel`), en+zh parity.

### B — Projects-home filter-row label removal (FIX-025)

File: `apps/web/src/app/routes/_app/projects/index.lazy.tsx` + locales. Remove
the leading "筛选:"/"Filter:" label span (`list.filterLabel`) from the unified
home filter row; the row starts directly with the status chips. Delete the
now-unused `filterLabel` key from both locales (parity guard). Disjoint file
from A → runs in parallel.

## DAG

- A (FIX-024) deps=[] / L3=4tbe0vv8 — sole owner of `-project-tag-filter.tsx` +
  its test + `list.tagFilter*` / `tags.empty`-area keys in
  `locales/{en,zh}/projects.json`.
- B (FIX-025) deps=[] / L3=qofnssso — sole owner of `index.lazy.tsx` +
  `list.filterLabel` removal in `locales/{en,zh}/projects.json`.
- Both edit `projects.json` but on non-adjacent keys (filterLabel L41 vs
  tagFilter* L48+) → 3-way merge auto-resolves; safe to run in parallel.

## Acceptance Criteria

- A: combobox trigger never renders the filled `primary` variant (`active`
  removed); single-select Button `variant` always `outline`; both lists exclude
  already-selected tags; all-selected → graceful empty state; trigger label
  reads "标签"/"Tags"; public props UNCHANGED; 3 consumers compile untouched;
  test updated (never-highlighted + selected-absent + renamed label) green.
- B: leading filter-row label gone from `index.lazy.tsx`; `filterLabel` key
  removed from both locales; en/zh parity intact; row spacing still correct.
- `bun run check` exits 0 (the `@milkdown/ctx` removeEventListener teardown in
  `-project-issue-panel.test.tsx` is a KNOWN FLAKE — grep to confirm before
  treating a test exit 1 as real).

## Out of Scope

- No components beyond the two files; do not change the chip rendering or the
  other consumers.
- No backend changes.

## Notes

- 2026-06-02 - L3 4tbe0vv8 first attempt produced ZERO commits (engine usage
  limit). Re-dispatched with the expanded 3-part spec (added the 更多→标签
  rename). FIX-025 added as a parallel L3 (qofnssso) per user scope addition.
