# 007 — App-wide button sizing standard (h-8 default, size-8 icon)

- Status: accepted
- Date: 2026-05-31
- Review by: 2026-11-30
- Scope: every interactive `Button` (`apps/web/src/shared/components/ui/button.tsx`)
  across the web app — toolbar actions, filters, status pills, tag chips,
  pagination, dropdown-menu triggers, segmented toggles, and icon-only buttons.
- Related: campaign l1-184b610h-btnstd

## Context

Button heights had drifted across the app. The same kind of control — a filter,
a toolbar action, a tag chip, a pagination arrow — appeared as `size="sm"`
(`h-7`), `size="lg"` (`h-9`), or with ad-hoc `className` height overrides
(`h-7` / `h-9` / `h-10`). Icon-only buttons were equally inconsistent
(`size="icon-sm"` / `size="icon-lg"` / ad-hoc `size-7` / `size-9`). The result
was rows that did not line up and no single answer to "how tall is a button".

The shared `Button` primitive
(`apps/web/src/shared/components/ui/button.tsx`) already defines a default size,
so the inconsistency was at the call sites, not in the token definitions.

## Decision

**All non-icon interactive buttons use the `Button` default size (`h-8 px-2.5`).
All icon-only buttons use `size="icon"` (`size-8`). These are THE standard;
other size variants are not used on buttons except the one narrow exception
below.**

The size tokens in `button.tsx` are the source of truth:

| Token | Height | Use |
|---|---|---|
| `default` | `h-8 px-2.5` | **The standard** — every non-icon clickable button |
| `icon` | `size-8` | **The standard** — every icon-only button |
| `sm` | `h-7` | not used on buttons |
| `lg` | `h-9` | not used on buttons |
| `xs` | `h-6` | tiny inline micro-affordances only (exception) |
| `icon-sm` | `size-7` | not used on buttons |
| `icon-lg` | `size-9` | not used on buttons |
| `icon-xs` | `size-6` | tiny inline icon micro-affordances only (exception) |

Rules:

1. **Non-icon clickable buttons** (filters, toolbar actions, status pills, tag
   chips, pagination prev/next, dropdown-menu trigger buttons, segmented
   toggles) use `size="default"` (`h-8`). Do not use `size="sm"` / `size="lg"`
   or ad-hoc `h-7` / `h-9` / `h-10` height overrides on them. Non-height styles
   (`rounded-full` pills, `rounded-md` / `text-xs` chips, `variant`, `px`
   overrides) are kept.
2. **Icon-only buttons** use `size="icon"` (`size-8`). Do not use
   `size="icon-sm"` / `size="icon-lg"` or ad-hoc `size-7` / `size-9`. Icon-only
   buttons keep their accessible name via `aria-label` (or `title`, which the
   primitive mirrors into `aria-label`).
3. **Exception:** a genuinely tiny inline affordance may keep `size="icon-xs"`
   or `size="xs"` (`size-6` / `h-6`) only where the standard size breaks row
   layout. Every kept exception must be noted in the change that keeps it.
4. **Excluded — do not touch:** `Badge` components (e.g. `h-5` count badges),
   shadcn UI primitive variant/size definitions themselves (`ui/button.tsx`,
   `ui/select.tsx`, `ui/table.tsx`, `ui/sidebar.tsx`), and form-field heights
   (`Input`, `SelectTrigger`; `h-9` text inputs / search boxes are fields, not
   buttons). Table cell paddings, spinner, and loader sizes are likewise out of
   scope.

A button already pinned to `className="h-8"` already meets the standard; drop a
redundant `size="sm"` so the default applies cleanly.

## Rationale

- **One height answers every row.** With buttons at `h-8` and icon buttons at
  `size-8`, toolbars, filter strips, and list rows align without per-call
  tuning.
- **The default is the standard.** Removing explicit `size`/height props from
  the common case means new buttons inherit the right size by doing nothing,
  and the token lives in exactly one place (`button.tsx`).
- **A bounded exception, not a free-for-all.** `xs` / `icon-xs` stay available
  for the rare inline micro-affordance, but each use is called out so drift
  cannot creep back in unnoticed.

## Alternatives considered

- **Leave per-call sizing as-is.** Rejected: that is the drift this decision
  removes.
- **Standardize on `sm` (`h-7`) instead of `default` (`h-8`).** Rejected: the
  primitive's default is `h-8`, so standardizing on it lets the common case drop
  the prop entirely; choosing `sm` would force an explicit `size` on every
  button.
- **Forbid the tiny size entirely.** Rejected: a few inline affordances genuinely
  break row layout at `size-8`; a noted, bounded exception is cheaper than
  contorting those layouts.

## Consequences

- New buttons should omit `size` (and any height `className`) unless they are
  icon-only (`size="icon"`) or a noted tiny exception.
- Reviewers reject ad-hoc `h-7` / `h-9` / `h-10` / `size-7` / `size-9` on
  buttons; form fields and badges are explicitly out of scope.
- The `button.tsx` size tokens remain the single source of truth; changing the
  standard height means changing the `default` / `icon` tokens, not call sites.

## Sunset / review

Revisit by **2026-11-30**. If a future design language needs more than one button
height as a deliberate system (e.g. a distinct compact density mode), supersede
this decision rather than reintroducing per-call sizing by accident.
