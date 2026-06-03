# REFACTOR-021 Migrate project + procurement tag surfaces to shared family

- Status: Todo
- Plan: [PLAN-062](../plan/PLAN-062.md)
- Owner: BKD L3 (campaign l1-75ymcfnr-gtag-20260603191645)
- Campaign: l1-75ymcfnr-gtag-20260603191645
- Depends on: [REFACTOR-020](REFACTOR-020.md)
- Updated: 2026-06-03

## Goal

Migrate all project- and procurement-module tag surfaces to the shared
`shared/components/tags/` family, then delete the now-unused project-local tag
components.

## Scope (edit only — `routes/_app/projects/**`)

- `index.lazy.tsx` — card display `TagBadgeList` → `TagChips`; tag filter
  dimension → `tagFilterDimension` (hide-when-empty).
- `-project-form-dialog.tsx` — picker → `TagInput`.
- `-project-settings-general.tsx` — picker → `TagInput`.
- `-project-issue-panel.tsx` — picker → `TagInput`.
- `-project-issues-tab.tsx` — tag filter → `tagFilterDimension` with
  `label: t("field.tags")` (replaces the inline `issues.tagFilter` label).
- `-project-procurement-tab.tsx` — form picker → `TagInput`; filter →
  `tagFilterDimension` (already hides when empty).
- `-project-procurement-panel.tsx` — picker → `TagInput`.
- DELETE `-tags-input.tsx` + `-tags-input.test.tsx` (dead) and
  `-project-tags-combobox.tsx` (adapter).

Keep `shared/lib/tag-utils.ts` (still used by `-project-form-logic.ts`).

### Label consistency (user-approved scope add 2026-06-03)

Every tag FILTER must read `标签`/`Tags`, never `按标签筛选`/`Filter by tag`. All
migrated filter dimensions use `label: t("field.tags")`. Also set the stale
keys in `locales/{en,zh}/projects.json` to `Tags`/`标签`:
`procurement.tagFilter` and `issues.tagFilter` (both become unused after the
switch to `field.tags`; non-blocking). Keep en↔zh parity.

## Acceptance

- Every project/procurement tag chip, picker, and filter uses the family.
- No remaining import of `TagBadgeList`, `TagsCombobox`,
  `-project-tags-combobox`, or `-tags-input` under `projects/`.
- `bun run check` EXIT 0 (modulo @milkdown flake); behavior parity (filtering
  semantics, create where allowed, hide-when-empty).

> Full self-contained implementation spec delivered to the L3 via BKD follow-up.
