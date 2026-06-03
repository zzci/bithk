# REFACTOR-022 Migrate contacts tag surfaces to shared family

- Status: Todo
- Plan: [PLAN-062](../plan/PLAN-062.md)
- Owner: BKD L3 (campaign l1-75ymcfnr-gtag-20260603191645)
- Campaign: l1-75ymcfnr-gtag-20260603191645
- Depends on: [REFACTOR-020](REFACTOR-020.md)
- Updated: 2026-06-03

## Goal

Migrate all contacts-module tag surfaces to the shared
`shared/components/tags/` family.

## Scope (edit only — `routes/_app/contacts/**` + contacts locales)

- `index.lazy.tsx` — card/list display `TagBadgeList` + hand-written badges →
  `TagChips`; tag filter dimension → `tagFilterDimension` (hide-when-empty).
- `-contact-panel.tsx` — view-mode display badges → `TagChips`; the hand-rolled
  free-text tag `<Input>` (with `tagDraft`/`commitTag`) → `TagInput`
  (`namespace="contacts"`, `suggestions={[]}`, create-only — preserves current
  free creation). Remove the now-unused `tagDraft` state and `commitTag`.
- `apps/web/src/locales/en/contacts.json` + `zh/contacts.json` — add
  `tags.searchPlaceholder`, `tags.create`, `tags.empty` (en/zh parity) needed
  by the combobox `TagInput`; keep existing `tags.remove` / `field.tags`.

Keep `shared/lib/tag-utils.ts` (still used by `-contact-form-logic.ts`).

## Acceptance

- Every contacts tag chip, input, and filter uses the family.
- No remaining import of `TagBadgeList` under `contacts/`; contact form tag
  input is the shared `TagInput`.
- `bun run check` EXIT 0 (modulo @milkdown flake); i18n parity gate green.

> Full self-contained implementation spec delivered to the L3 via BKD follow-up.
