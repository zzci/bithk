# PLAN-062 Global unified tag component family

- Status: Implementing
- Owner: BKD L2 lc757j1x (campaign l1-75ymcfnr-gtag-20260603191645)
- Campaign: l1-75ymcfnr-gtag-20260603191645
- Updated: 2026-06-03

## Problem

Tag UIs are scattered and inconsistent across modules:

- Display chips: `shared/components/tag-badge-list.tsx` (first-N + overflow) on
  project/ship/contact list cards, plus hand-written `<Badge>` chips in detail
  panels (contact view, ship card).
- Edit/input: `shared/components/tags-combobox.tsx` (Linear-style picker +
  create) wrapped by `projects/-project-tags-combobox.tsx` and
  `ships/-ship-tags-combobox.tsx`; the now-dead `projects/-tags-input.tsx`
  (free-text); and a hand-rolled free-text input inside
  `contacts/-contact-panel.tsx`.
- Filter: the `ListFilter` `mode:"multi"` tags dimension is rebuilt inline in
  every list (projects/ships/contacts index, issues tab, procurement tab) with
  inconsistent hide-when-empty (only procurement hides it when empty).

## Goal

One global tag component family under `apps/web/src/shared/components/tags/`,
all built on a shared `TagChip` primitive so display / filter / edit chips look
identical app-wide, adopted across every module. No backend changes (tag data
and APIs unchanged); pure frontend refactor.

## Family API

- `TagChip` (primitive) — one chip, consistent style; optional removable `×`
  with `aria-label`.
- `TagChips` (display) — read-only list of chips with `max` + `+N` overflow
  (subsumes `TagBadgeList` and hand-written display badges).
- `TagInput` (edit) — combobox picker: removable chips + dashed "Tags" trigger
  with search + create; `suggestions` + `namespace` + `allowCreate`. Replaces
  `TagsCombobox`, `-project-tags-combobox`, `-ship-tags-combobox`, the dead
  `-tags-input`, and the contact-panel hand-rolled input. Keeps create where
  currently allowed.
- `TagFilter` — `tagFilterDimension({ tags, value, onChange, label })` builds
  the standard `ListFilter` multi dimension and returns `null` when there are
  no tags (consistent hide-when-empty everywhere). Visual + interaction stay
  identical because it feeds the existing `ListFilter`.

## Decomposition (DAG)

| L3 | Task | Deps | Owns |
| --- | --- | --- | --- |
| REFACTOR-020 | Create `shared/components/tags/` family + unit tests | — | new `shared/components/tags/**` only |
| REFACTOR-021 | Migrate projects + procurement surfaces | REFACTOR-020 | `routes/_app/projects/**` |
| REFACTOR-022 | Migrate contacts surfaces | REFACTOR-020 | `routes/_app/contacts/**` |
| REFACTOR-023 | Migrate ships surfaces | REFACTOR-020 | `routes/_app/ships/**` |

REFACTOR-020 merges first (foundation, no consumer changes so build stays
green). REFACTOR-021/022/023 own disjoint route directories and can run in
parallel afterward. `list-filter.tsx` is NOT modified (the dimension builder
only constructs a `FilterDimension`). Admin tag-vocabulary CRUD
(`-settings-tag-admin.tsx`) is out of scope (optional `TagChip` reuse only).

## Behavior parity

- Filtering semantics unchanged (multi-select OR-union as today).
- Create-tag kept where currently allowed.
- Hide-filter-when-empty kept, now applied consistently across all lists.
- i18n en/zh parity: reuse `field.tags` + `tags.*`; add missing keys only
  (contacts namespace lacks `tags.searchPlaceholder/create/empty`).

## Acceptance

- Single `shared/components/tags/` family consumed by every tag surface.
- `TagBadgeList`, `TagsCombobox`, `-project-tags-combobox`, `-ship-tags-combobox`,
  `-tags-input` removed once unused.
- `bun run check` EXIT 0 (modulo known @milkdown teardown flake).
- Family unit tests + key migration coverage pass.
- Merge target: each L3 merges `--no-ff` into `bkd/lc757j1x`.
