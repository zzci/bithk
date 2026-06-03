# REFACTOR-024 Remove dead shared tag-badge-list + tags-combobox after migration

- Status: Todo
- Plan: [PLAN-062](../plan/PLAN-062.md)
- Owner: BKD L3 (campaign l1-75ymcfnr-gtag-20260603191645)
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

> Dispatched after REFACTOR-021/022/023 merge into `bkd/lc757j1x`. Full
> self-contained spec delivered to the L3 via BKD follow-up.
