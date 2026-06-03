# REFACTOR-024 Remove dead shared tag-badge-list + tags-combobox after migration

- Status: Completed
- Plan: [PLAN-066](../plan/PLAN-066.md)
- Owner: BKD L3 p3r1oer8 (campaign l1-75ymcfnr-gtag-20260603191645)
- Campaign: l1-75ymcfnr-gtag-20260603191645
- Depends on: [REFACTOR-021](REFACTOR-021.md), [REFACTOR-022](REFACTOR-022.md), [REFACTOR-023](REFACTOR-023.md)
- Updated: 2026-06-03

## Goal

After all module migrations land, delete the now-unused shared pre-family tag
components so the `shared/components/tags/` family is the single tag surface.

## Scope (delete only, once grep proves zero importers)

- `apps/web/src/shared/components/tag-badge-list.tsx`
- `apps/web/src/shared/components/tags-combobox.tsx`
- `apps/web/src/shared/components/tags-combobox.test.tsx`

Keep `apps/web/src/shared/lib/tag-utils.ts` (still used by form-logic).

## Acceptance

- `grep -rn "tag-badge-list\|TagBadgeList\|tags-combobox\|TagsCombobox" apps/web/src`
  returns only the new family / nothing — no live importer of the deleted files.
- `bun run check` EXIT 0 (modulo @milkdown flake).

> **Completed 2026-06-03** — L3 `bkd/p3r1oer8` deletion commit `9118dd3`
> cherry-picked into `bkd/lc757j1x` @fad75cf (deleted tag-badge-list.tsx,
> tags-combobox.tsx, tags-combobox.test.tsx; dropped the stale comment in
> tag-chips.tsx). Final full `bun run check` EXIT 0 (web 674/674, api green,
> build/i18n/env/api-docs all pass). No live importer of the old shared
> components remains.
