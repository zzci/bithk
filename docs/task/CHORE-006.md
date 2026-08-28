# CHORE-006 - Sweep the remaining non-English comments

- Status: Completed (2026-08-28)
- Plan: -
- Depends on: [REFACTOR-039](REFACTOR-039.md) (merge first — two of the files are rewritten by it)
- Created: 2026-08-28

## Goal

The repository rule is English-only for code, comments and remote-visible
metadata. **Four** pre-existing non-English comments survive, found while
landing PLAN-108 (the original list said five; the fifth hit was not a
comment — see below). Paths as they stand after REFACTOR-039 moved the
documents routes:

- `apps/web/src/shared/components/list-filter.tsx`
- `apps/web/src/app/routes/_app/-documents-shared.ts`
- `apps/web/src/app/routes/_app/-documents-tags.tsx`
- `apps/web/src/app/routes/_app/projects/-project-procurement-panel.tsx`

Not a comment, deliberately left alone:
`apps/web/src/shared/components/app-sidebar.tsx` line 41,
`{ code: "zh", label: "中文" }` inside the `LANGUAGES` const. That is
the language switcher's own option label, not a comment — a reader choosing
Chinese must see the Chinese option rendered in Chinese. It is deliberate
content, not a pending translation.

## Scope

Translate those comments to English, preserving meaning. Comments only — no
behaviour, naming, or formatting changes in the same commit.

Re-run the search across the whole repository (source and docs, excluding
`locales/**` and any deliberately Chinese fixture) so the sweep is complete
rather than limited to the five known hits.

## Verification

- A repo-wide grep for CJK characters outside `locales/**` returns only
  deliberate content (i18n payloads, seed payload data).
- `bun run check` EXIT 0.

## Outcome (2026-08-28)

Four comments were translated, not five. The fifth listed hit was the
`app-sidebar.tsx` language-switcher label described above, which is content
rather than a comment and stays as it is.

The repo-wide re-scan left the `docs/` corpus untouched: 99 files carrying
roughly 1338 CJK lines, almost entirely historical `docs/plan/PLAN-0xx.md` and
`docs/task/*.md` archive records, plus `docs/ui-consistency-audit.md` and six
Chinese task titles in `docs/task/index.md`. Whether to translate that
historical corpus is an open decision for the repository owner — it is neither
a defect nor part of this task, and nothing in it was changed here.
