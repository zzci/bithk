# REFACTOR-020 Create shared tag component family (TagChip/TagChips/TagInput/TagFilter)

- Status: Completed
- Plan: [PLAN-066](../plan/PLAN-066.md)
- Owner: BKD L3 msitkgis (campaign l1-75ymcfnr-gtag-20260603191645)
- Campaign: l1-75ymcfnr-gtag-20260603191645
- Updated: 2026-06-03

## Goal

Create `apps/web/src/shared/components/tags/` with a `TagChip` primitive and the
`TagChips` (display), `TagInput` (edit), and `TagFilter` (`tagFilterDimension`)
components built on it, plus unit tests. Consumers are NOT changed here — old
tag components stay in place so the build remains green; migration L3s
(REFACTOR-021/022/023) remove them.

## Scope (create only)

- `apps/web/src/shared/components/tags/tag-chip.tsx`
- `apps/web/src/shared/components/tags/tag-chips.tsx`
- `apps/web/src/shared/components/tags/tag-input.tsx`
- `apps/web/src/shared/components/tags/tag-filter.tsx`
- `apps/web/src/shared/components/tags/index.ts` (barrel)
- co-located `*.test.tsx` for each

## API

- `TagChip` — `{ label; removable?; onRemove?; removeLabel?; variant?; className? }`;
  reuses the ghost `icon-xs` `X` + `aria-label` pattern from the old
  `tags-combobox`.
- `TagChips` — `{ tags: readonly {id?; name}[]; max?; variant?; className?;
  moreClassName?; renderMore? }`; identical first-N + `+N` overflow to
  `tag-badge-list.tsx`.
- `TagInput` — `{ value; onChange; suggestions?; namespace?; allowCreate? }`;
  combobox behavior identical to old `TagsCombobox` (removable chips via
  `TagChip` + dashed "Tags" trigger with search + create). Works with empty
  suggestions (create-only).
- `tagFilterDimension({ tags, value, onChange, label })` → `FilterDimension |
  null`; returns `null` when `tags.length === 0`, else a `mode:"multi"`
  dimension `{ key:"tags", label, value, onChange, options: tags.map(t =>
  ({value:t.id,label:t.name})) }` for the existing `ListFilter`.

## Acceptance

- All four exported from the barrel; built on `TagChip`.
- Tests cover: chip label + removable × fires onRemove; chips overflow `+N`;
  input add/remove/create + suggestion filtering; dimension null-when-empty and
  shape when non-empty.
- `bun run check` EXIT 0 (modulo @milkdown flake).

> **Completed 2026-06-03** — L3 `bkd/msitkgis` @6dec901 (9 files, +352, purely
> additive) merged `--no-ff` into `bkd/lc757j1x` @4dd1602; post-merge
> `bun run check` EXIT 0 (web 683/683, api green, build/i18n/env/api-docs all
> pass; only noise = 6 pre-existing lint warnings + 26 heuristic-unused i18n
> keys, non-blocking). Web tests use vitest (not bun:test).
