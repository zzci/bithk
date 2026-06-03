# PLAN-056 Restore whole-card navigation on the projects list

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 cjeubt6k
- **campaignId**: l1-75ymcfnr-cardnav-20260603114731
- **tasks**: [FIX-034](../task/FIX-034.md)
- **createdAt**: 2026-06-03

## Goal

On the projects LIST (`apps/web/src/app/routes/_app/projects/index.lazy.tsx`,
`ProjectsGrid` card), clicking anywhere on a project card must navigate to its
detail (`/projects/$projectId`), as it did before. Today only the title text is
clickable.

## Root cause

Commit 078c687 (RA-016) migrated the card-title click target from a native
`<button>` to the shadcn `<Button>`. The card relied on a "stretched link"
pattern: the title element carried an `::after { position:absolute; inset:0 }`
overlay that stretched over the whole `relative` Card, so clicking anywhere
(except the `z-10` Settings button) navigated. With the shadcn `<Button>` the
`after:absolute after:inset-0` no longer covers the card — only the Button
(title) itself is clickable.

## Fix

Restore whole-card navigation. Clicking anywhere on the card (cover image,
title, description, tag row) navigates via `openProject(project.id)`; the
Settings button stays `z-10` and is NOT triggered by card clicks. Keyboard
accessible (focusable, Enter activates) with a visible focus ring; no console
errors. Do NOT rely on `after:absolute inset-0` applied to a shadcn `<Button>`.

Preferred approaches (L3 picks the clean one, verify in the running app):
- **Option A**: revert the title click target to a native
  `<button type="button">` carrying the stretched
  `after:absolute after:inset-0` overlay (as pre-078c687), with focus-visible
  styling for a11y.
- **Option B**: keep the title as plain text and add a dedicated full-card
  click overlay — a native `<button>` or TanStack Router `<Link>` positioned
  `absolute inset-0` over the card (below the Settings button's `z-10`), with an
  `aria-label` naming the project.

## Scope / Constraints

- Only the `ProjectsGrid` card in `index.lazy.tsx`. Keep the diff minimal and
  localized.
- A concurrent foreign campaign (REFACTOR-01x shared components) actively churns
  this file — keep the change minimal; L1 resolves any merge conflict.
- The known `check:i18n` red (pagination-footer.tsx `procurement.total`,
  REFACTOR-012) is foreign — add no NEW failure.

## Acceptance Criteria

- Click cover / body / title / tag row → all navigate to the project detail.
- Click Settings → opens settings only (card does not navigate).
- Keyboard: card target focusable, Enter activates, visible focus ring.
- No console errors.
- `bun run check` passes (web + api tests green); only the known foreign
  pagination-footer i18n red + the @milkdown flake remain; no NEW failure.

## Decomposition

1 L3 (FIX-034): localized card-navigation fix in `index.lazy.tsx`.
