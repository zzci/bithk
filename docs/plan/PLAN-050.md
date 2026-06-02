# PLAN-050 Tag-filter pinned-chips + dropdown hybrid

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 28377ph1
- **campaignId**: l1-75ymcfnr-tagpin-20260602052326
- **tasks**: [FIX-027](../task/FIX-027.md)
- **createdAt**: 2026-06-02

## Goal

Rework the shared `ProjectTagFilter`
(`apps/web/src/app/routes/_app/projects/-project-tag-filter.tsx`, used by the
issues tab, procurement tab, and projects home) from the current
single-"标签"-selector + removable-chips design into a HYBRID pinned-chips +
dropdown filter. Public props stay UNCHANGED so the three consumers need no
prop edits.

1. **Pinned inline chips.** Auto-pin the TOP-N most-used tags. The API returns
   tags most-used-first (`tag.service.ts:69` orders by `desc(usageCount),
   name`), so pin the first `N=5`. Render them as inline toggle chips: real
   `Button`s with `aria-pressed`, highlighted/active when selected, neutral
   when not. Pinned chips are ALWAYS shown and are NOT removable (no × button) —
   they are filter toggles only.
2. **"标签" dropdown.** Lists ONLY the remaining NON-pinned tags — exclude the
   pinned top-N AND any already-selected non-pinned tags. Graceful empty state
   via the existing `list.tagFilterNoMore` key. Multi-select keeps the
   searchable combobox; single-select keeps the dropdown menu.
3. **Non-pinned selected → removable chips.** Tags chosen from the dropdown
   render as removable chips (label + trailing × `Button` with `aria-label`)
   to the right, as today. Pinned tags never render as removable chips even
   when selected (their pinned chip shows the active state instead).
4. **Neutral dropdown trigger.** The "标签" dropdown/combobox trigger stays
   neutral/outline regardless of selection (keep the prior no-highlight rule).

## Modes

- **Multi-select** (issues + procurement, `multiple` + `selectedTagIds` +
  `onToggle`): pinned chips toggle independently; multiple may be active;
  non-pinned selected show as removable chips.
- **Single-select** (projects home, `selectedTagId` + `onSelect` + `onClear`):
  selecting a pinned chip selects that one tag (highlight); selecting from the
  dropdown selects one non-pinned tag shown as a removable chip; clicking an
  active pinned chip again, or the × on a non-pinned chip, clears the filter
  (calls `onClear`). The projects-home unified 筛选 row (正常/已归档 status chips
  + this filter) stays intact; status chips remain toggles with no ×.
- **Edge:** fewer than N tags total → pin all of them; the dropdown shows the
  empty state / is hidden.

## DAG

- FIX-027 deps=[] / L3=66nt8c3f — sole owner of `-project-tag-filter.tsx` + its test
  `-project-tag-filter.test.tsx` + any new `list.tagFilter*` keys in
  `locales/{en,zh}/projects.json`. Single component → ONE L3 (no parallel
  same-file work). Consumers (`index.lazy.tsx`, `-project-issues-tab.tsx`,
  `-project-procurement-tab.tsx`) untouched (props unchanged).

## Acceptance Criteria

- Top-5 (or all if <5) most-used tags render as inline pinned toggle chips:
  real `Button`s with `aria-pressed`, active when selected, neutral otherwise,
  never an × button.
- Dropdown/combobox lists only non-pinned, non-selected tags; all-consumed →
  graceful `tagFilterNoMore` empty state.
- Non-pinned selected tags render as removable chips (× `Button` with
  `aria-label`); pinned selected tags do NOT also render as removable chips.
- Dropdown trigger stays neutral/outline regardless of selection.
- Multi-select toggles independently; single-select keeps single-tag semantics
  (pinned re-click / chip × → `onClear`).
- `N=5` constant; edge `<5` tags → pin all, dropdown hidden/empty.
- Public props UNCHANGED; 3 consumers compile untouched.
- i18n en/zh parity for any new strings (e.g. pinned-chip aria-label).
- `-project-tag-filter.test.tsx` updated for pinned/dropdown/removable behavior.
- `bun run check` exits 0 (`@milkdown/ctx` teardown in
  `-project-issue-panel.test.tsx` is a KNOWN FLAKE — grep to confirm before
  treating a test exit 1 as real; `bun install` first if a fresh worktree errors
  127).

## Out of Scope

- Only the tag-filter component + its test + i18n keys. No backend; no status
  enum/color changes; do not touch the create-issue dialog or the consumers'
  logic beyond what unchanged props already cover.

## Notes

- 2026-06-02 - Created at L2 28377ph1 bootstrap.
- 2026-06-02 - FIX-027 (L3 66nt8c3f) merged + verified; PLAN Completed. branch bkd/28377ph1 @ d06c5ad, check EXIT=0.
