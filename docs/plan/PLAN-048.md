# PLAN-048 Tag-filter neutral trigger + hide selected from list

- **status**: In Progress
- **owner**: l1-75ymcfnr / L2 h9ieukwl
- **campaignId**: l1-75ymcfnr-tagfx-20260602025356
- **tasks**: [FIX-024](../task/FIX-024.md)
- **createdAt**: 2026-06-02

## Goal

Two small follow-up tweaks to the redesigned `ProjectTagFilter`
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
   selected / none remain, show a graceful empty / "no more tags" state (no
   crash, no empty-flicker).

## DAG

- Single L3 (FIX-024) deps=[] — sole file owner of the tag-filter component +
  its test (+ optional i18n empty-state key in `locales/{en,zh}/projects.json`).

## Acceptance Criteria

- Multi-select combobox trigger: never renders the filled `primary` variant;
  the `active`-driven highlight is gone — trigger stays outline always.
- Single-select dropdown trigger: `variant` is always `outline`, never
  `default`, regardless of selection.
- Both lists exclude already-selected tags; only unselected tags are listed.
- All-selected / none-remaining shows a graceful empty state (no crash, no
  flicker).
- Public props/signatures UNCHANGED; the 3 consumers (issues tab, procurement
  tab, projects list `index.lazy.tsx`) compile untouched.
- `-project-tag-filter.test.tsx` updated: trigger never-highlighted; selected
  tags absent from the list. Green.
- `bun run check` exits 0 (the `@milkdown/ctx` removeEventListener teardown in
  `-project-issue-panel.test.tsx` is a KNOWN FLAKE — grep to confirm before
  treating a test exit 1 as real).

## Out of Scope

- No other components; do not change the chip rendering or the consumers.
- No backend changes.
- i18n only if a new empty-state string is needed (en + zh parity).
