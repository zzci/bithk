# CHORE-006 - Sweep the remaining non-English comments

- Status: In Progress
- Plan: -
- Depends on: [REFACTOR-039](REFACTOR-039.md) (merge first — two of the files are rewritten by it)
- Created: 2026-08-28

## Goal

The repository rule is English-only for code, comments and remote-visible
metadata. Five pre-existing non-English comments survive, found while landing
PLAN-108:

- `apps/web/src/shared/components/list-filter.tsx`
- `apps/web/src/app/components/app-sidebar.tsx`
- `apps/web/src/app/routes/_app/documents/-documents-shared.ts`
- `apps/web/src/app/routes/_app/documents/-documents-tags.tsx`
- `apps/web/src/app/routes/_app/projects/-project-procurement-panel.tsx`

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
