# 005 — Global semantic color tokens (local extension to base-nova)

- Status: accepted
- Date: 2026-05-25
- Review by: 2026-11-25
- Scope: `apps/web` theme tokens in `index.css`; status color maps in
  `shared/lib/status-colors.ts`, ship/project/contact modules

## Context

`pma-web` hard-locks the UI to shadcn/ui base-nova. base-nova ships only the
standard tokens (`primary`, `secondary`, `muted`, `accent`, `destructive`,
`chart-1..5`) — it has **no** semantic status colors. The app needs a single
color system to express status across modules: ship lifecycle stages, ship /
project record status, and issue / maintenance-order status. Before this change
each module solved it differently — ship hard-coded Tailwind palette classes
(`bg-emerald-50 …`), while projects and contacts rendered everything in neutral
gray `Badge` variants — so the same status read differently in different places.

## Decision

Add a local set of semantic + categorical tokens to `index.css`, dual-channel
(`:root` + `.dark`), mapped through `@theme inline`:

- `success` (emerald), `warning` (amber), `info` (cyan) — true status meaning.
- `accent-design` (violet), `accent-maint` (indigo) — categorical accents for
  ship lifecycle stages that carry no status meaning.
- Existing `destructive` and `muted` are reused (danger / neutral-archived).

Tokens are consumed via the shadcn token + opacity idiom (`bg-success/10
text-success`), so one class string covers both themes. Cross-module status →
token maps live in `shared/lib/status-colors.ts` (`RECORD_STATUS_BADGE`,
`ISSUE_STATUS_BADGE`); ship lifecycle styling stays in `ships/-ship-colors.ts`
but reads the same tokens. `chart-1..5` were also refreshed to the shadcn
official multi-hue palette (they had been a single violet hue band).

`primary` stays blue — unchanged.

## Consequences

- The theme diverges from a stock base-nova token set by five extra tokens
  (+ foregrounds). This is an additive extension, not a fork of base-nova
  components, so the UI lock still holds.
- Any new status surface should map through `shared/lib/status-colors.ts` (or
  the same tokens) rather than introducing fresh Tailwind palette classes.
- Procurement status badges (`-project-procurement-tab.tsx`) were left on the
  neutral `outline` variant — that enum is procurement-specific and out of scope
  here; unify it if/when it grows a color need.

## Review

Revisit by **2026-11-25**, or sooner if base-nova upstream adds official
semantic tokens (adopt those and retire this extension), or if a charting
feature lands and needs the chart tokens re-tuned.
