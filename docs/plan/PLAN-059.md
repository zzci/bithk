# PLAN-059 Project overview 2-column pinned/description + minimal pinned rows

- **status**: Implementing
- **owner**: l1-75ymcfnr / L2 0n0nesqv
- **campaignId**: l1-75ymcfnr-ovlay-20260603171713
- **tasks**: [UI-022](../task/UI-022.md)
- **createdAt**: 2026-06-03

## Goal

Two small layout changes to the project OVERVIEW tab
(`apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx`):

1. Place the 描述 (description) card and the 置顶 (pinned) card SIDE-BY-SIDE in a
   left-right 2-column row (description left, pinned right), mirroring the
   latest-issues / latest-procurements grid below it. Stacks to a single column
   on small screens.
2. Make the 置顶 (pinned) list a SINGLE-ROW MINIMAL list: drop the `pinnedAt`
   date and other secondary metadata so each pinned item is one compact line —
   mirror the single-line `ActivityRow` presentation already used by the
   latest-activity lists. Keep click-to-open behavior.

## Current layout

`space-y-6` column of: `ProjectInfoCard` (description, full width) →
`ProjectPinnedCard` (置顶, full width) → a `grid lg:grid-cols-2` row with
[latest issues | latest procurements] (single-line `ActivityRow` items).

The pinned row (`PinnedRow`) is currently TWO lines: line 1 = title + `Pin`
icon; line 2 = `RowMeta` with [kind badge][status badge][`formatDate(pinnedAt)`].

## Scope / Constraints

- ONLY `apps/web/src/app/routes/_app/projects/-project-overview-tab.tsx` and its
  test `…/-project-overview-tab.test.tsx`. No backend. No other files.
- Wrap `ProjectInfoCard` + `ProjectPinnedCard` in `grid gap-4 lg:grid-cols-2`
  (always 2-col on `lg`, independent of procurement visibility). Keep the
  latest-activity grid row below unchanged.
- `PinnedRow` becomes a single horizontal line mirroring `ActivityRow`
  (`ACTIVITY_ROW_CLASS`): leading type icon (`ClipboardList` for issue /
  `Package` for procurement) + title (`min-w-0 flex-1 truncate`) + trailing
  status `Badge` (reuse the existing status-badge logic). Remove the `pinnedAt`
  span, the kind text badge, the trailing `Pin` icon, and the two-line `RowMeta`
  wrapper from the pinned row.
- The leading type icon is the sole at-a-glance type indicator, so it carries an
  ACCESSIBLE NAME rather than `aria-hidden`: `role="img"` + `aria-label`
  reusing the existing i18n keys `overview.pinKind.issue` ("Work order") /
  `overview.pinKind.procurement` ("Procurement"). Those keys move from the
  removed text badge onto the icon (still used → not removed; no new keys). The
  `item.type` discriminator is the strict union `"issue" | "procurement"`, so
  the mapping is binary (no dead third branch); only widen to a neutral `Pin`
  fallback if the union is actually wider.
- Surgical cleanup: remove now-unused module members — `formatDate` import,
  `RowMeta` helper, `ROW_BUTTON_CLASS` (all become unused once `PinnedRow`
  switches to the single-line `ActivityRow` shape). Keep the `Pin` import (still
  used in the pinned card header) and everything else.
- i18n: reuse existing keys; only add if strictly required (en+zh parity).
- Keep latest issues/procurements, loading/empty/error states, view-all, and
  per-row navigation (`onOpenTab`) unchanged.
- Dev phase: breaking changes OK.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown/ctx
  teardown flake (exit1 with 0 real test failures).

## Acceptance Criteria

- Overview top row renders description + pinned cards side-by-side in a
  2-column grid on `lg` (stacks on small screens); the latest-activity grid row
  below is unchanged.
- Each pinned row is a single compact line: leading type icon + title +
  trailing status badge; no `pinnedAt` date, no kind text badge, no second line.
- Click-to-open behavior is preserved (issue → issues tab, procurement →
  procurement tab; disabled when procurement not viewable).
- `formatDate` / `RowMeta` / `ROW_BUTTON_CLASS` are removed as unused; no other
  unused symbols introduced.
- Each pinned row's leading type icon has an accessible name ("Work order" /
  "Procurement"); the test asserts the icon by role+name
  (`getByRole("img", { name: ... })`) within the "Pinned" list.
- Test updated for the new pinned-row content + 2-col layout; `bun run check`
  EXIT=0 (modulo the @milkdown flake).

## Decomposition (1 L3)

1. **L3-1 frontend** — edit `-project-overview-tab.tsx` (2-col top row + single
   line `PinnedRow` + unused-symbol cleanup) and update
   `-project-overview-tab.test.tsx` (drop the "kind badges" text assertions in
   the mixed-pinned-list test → assert both titles render in the "Pinned" list
   as single-line rows; keep the navigation/disabled tests). Run `bun run
   check`.
