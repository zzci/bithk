# PLAN-055 Drive-style multi-dropdown unified ListFilter + full adoption

- **status**: Completed
- **owner**: direct (PMA)
- **tasks**: [REFACTOR-018](../task/REFACTOR-018.md)
- **createdAt**: 2026-06-03
- **supersedes**: extends [PLAN-054](PLAN-054.md)

## Goal

Rewrite the shared `ListFilter` from a single aggregated "Filter" dropdown into a
Google-Drive-style bar where **each dimension is its own independent dropdown**
(状态 ▾ / 优先级 ▾ / 类别 ▾ …). Selecting a value highlights that dropdown,
swaps its label to the selected value, and appends an independent × remove
button; a trailing "Clear filters" action resets everything. Multi-select
dimensions (tags / categories) surface each selected value as its own removable
chip ("display to the selection area"). Unify the drive file filter onto the same
component and delete the duplicate filter components.

Resolves audit finding **P4 (filter controls fragmented across three styles)**.

## Target behaviour (matches reference screenshots)

- Unselected: `[类型 ▾] [相关人员 ▾] [修改时间 ▾] [来源 ▾]` — neutral outline
  triggers showing the dimension label.
- Selected (single): trigger highlights (primary tint), label becomes the chosen
  value, and a connected × button removes it (back to `defaultValue`).
- Selected (multi): the dropdown trigger keeps the dimension label (so more
  values can be added); **each** selected value renders as its own highlighted
  removable chip right after the trigger.
- A trailing **Clear filters** button appears whenever any dimension is active and
  resets all of them.

## Component API

`apps/web/src/shared/components/list-filter.tsx`:

- Keep the discriminated `FilterDimension` union (`single` / `multi`) with exact
  `value`/`onChange` types. `single` keeps `defaultValue` (the "unset" value that
  shows no chip and is the × / clear target). `multi` clears to `[]`.
- `FilterOption` gains an optional `icon?: ReactNode` (drive type dimension).
- **Remove** the residency model (`resident` / `residentCount` /
  `ResidencyConfig`) and the aggregated single-trigger dropdown — every dimension
  is now its own dropdown. No inline always-visible toggle chips.
- Accessible: dropdown triggers and × buttons are real `Button`s with
  `aria-label`; single options use `DropdownMenuItem` (check on the active value),
  multi options use `DropdownMenuCheckboxItem`.

## Scope

Rewrite + adopt everywhere (D2 = full unification, D1 = each selected value its
own chip):

- Rewrite `shared/components/list-filter.tsx` and its test.
- Migrate all 9 `ListFilter` call sites (drop `resident` / `residentCount`):
  projects/ships/contacts lists, admin users/cron/audit/policies-tuples,
  project issues + procurement tabs.
- Replace drive `DriveFilterBar` (file + share surfaces) with `ListFilter`;
  delete `-drive-file-list-filter-bar.tsx`, move its type label/icon mapping into
  a small dimension-builder helper.
- Fold the procurement tags `ProjectTagFilter` into the procurement `ListFilter`
  as a `multi` dimension; delete `-project-tag-filter.tsx` and its now-unused
  `-project-tag-filter.fit.ts(.test)`.
- i18n: add `list.clearFilters` (en/zh, projects ns, reused by the component).

Not in scope: list business logic, API, search-create-bar, table/grid layout.

## Risks

- Large diff (~11 call sites + 3 component deletions). Dev phase → breaking
  changes accepted, no compat shims.
- Drive string-union filter values (`DriveTypeFilter` etc.) adapt to generic
  `dimensions` via `defaultValue: "all"`.
- Behavioural change: status/role/result filters move from always-visible inline
  chips to dropdowns; tag "pinned common tags" residency is gone (intended).

## Acceptance Criteria

- Each dimension renders an independent dropdown; selected single → highlighted
  trigger + connected ×; selected multi → per-value removable chips; Clear-filters
  resets all.
- Drive file + share surfaces use the same component; `DriveFilterBar`,
  `ProjectTagFilter`, `-project-tag-filter.fit*` deleted; no dangling imports.
- a11y (Button triggers, aria-label removes, aria-checked/Check on active);
  i18n en/zh parity.
- `bun run check` passes (only the known foreign pagination-footer i18n red may
  remain; add no NEW failure).
