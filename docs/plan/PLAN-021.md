# PLAN-021 Ships/projects/contacts shadcn baseline normalization

- **status**: completed
- **createdAt**: 2026-05-25 20:00
- **approvedAt**: 2026-05-25 20:00
- **completedAt**: 2026-05-25 20:40
- **relatedTask**: UI-008

## Context

UI-001 redesigned ships/projects/contacts from a prototype, introducing a
visual language no other module uses. The `_app` layout already pads content
via `<main className="... px-4 py-3 md:px-6 md:py-4">`, and the shadcn `Card`
(base-nova) already encodes the canonical surface (`rounded-xl`, `bg-card`,
`ring-1 ring-foreground/10`, `py-4`). The three modules instead use:

- A redundant `rounded-2xl bg-background p-1 md:p-3` page wrapper
  (`ships/index`, `ships/$shipId`).
- Decorative `ShipIllustration` / `DetailShipIllustration` graphics.
- Hand-rolled `rounded-xl|2xl|lg bg-card [border] [ring-1 ring-foreground/5]
  [shadow-sm]` surfaces that drift from the real `<Card>`.
- Inconsistent root spacing (ships `space-y-6`, projects `gap-5`,
  contacts `gap-4`).

## Proposal

Normalize to the shared baseline, module by module:

1. Page roots: drop the `rounded-2xl bg-background p-1 md:p-3` wrapper; use
   `space-y-6` for the three list pages and the two detail pages.
2. Remove `ShipIllustration` and `DetailShipIllustration` and their usages.
3. Replace hand-rolled `bg-card` surfaces with the `<Card>` component (with
   `CardHeader`/`CardContent` where it reads cleanly) so they inherit canonical
   tokens. Drop `ring-1 ring-foreground/5` and ad-hoc `shadow-sm`.
4. Rebuild the ships list `ShipCard` as a `<Card role="button">` mirroring the
   projects `ProjectsGrid` card (title + status badge + spec grid + tag/meta
   chips), so the two list pages share one card pattern.
5. Update affected `-*.test.tsx` only where a moved selector requires it.

Out of scope:

- Behavior, data, routing, permissions, i18n copy (keys reused; remove keys only
  if a label disappears).
- Other modules (drive, documents, admin) and the app shell.
- New dependencies or new shared primitives.

## Alternatives

- Keep the illustrations as a ships-only flourish. Rejected: the user asked for
  one consistent theme across the three modules.
- Define a new shared "module surface" wrapper. Rejected: `<Card>` already is
  that primitive; a new wrapper would re-fork the theme.

## Annotations

- 2026-05-25 20:00 - Investigation + proposal approved by user ("全部处理"),
  tree committed clean. Implementing.
- 2026-05-25 20:40 - Completed. All five proposal items applied across the three
  modules; illustrations and the page wrapper removed; `ShipCard` rebuilt on the
  projects `Card` pattern. Two obsolete UI-006/UI-007 KPI-strip tests repurposed
  to assert the surviving filter chips. lint + typecheck + 402 web tests + web
  build all green.
