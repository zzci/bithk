# PLAN-017 Independent module surfaces for ships, projects, and contacts

- **status**: completed
- **createdAt**: 2026-05-25 16:45
- **approvedAt**: 2026-05-25 16:50
- **relatedTask**: UI-002

## Context

UI-001 redesigned the ships, projects, and contacts content pages and completed
with `bun run check` green. The user now wants those content pages to feel like
independent content modules rather than visually continuing from the global
sidebar, and wants fewer horizontal lines.

Current findings:

- The global app layout is in `apps/web/src/app/routes/_app.tsx`. It owns the
  sidebar, mobile header, and the `main` padding. This remains out of scope.
- Ships pages currently use direct route roots and many local dividers:
  `apps/web/src/app/routes/_app/ships/index.lazy.tsx` and
  `apps/web/src/app/routes/_app/ships/$shipId.lazy.tsx`.
- Projects pages use direct route roots plus hero/tabs and a pagination
  `border-t`: `apps/web/src/app/routes/_app/projects/index.lazy.tsx` and
  `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx`.
- Contacts list has a bordered filter panel, dashed inner separator, and a
  bordered table wrapper in `apps/web/src/app/routes/_app/contacts/index.lazy.tsx`.
- Existing behavior constraints from UI-001 still apply: do not touch backend,
  global sidebar, app shell, unrelated modules, shared FileBrowser behavior, or
  shared UI primitives unless the change is strictly local and necessary.

## Proposal

1. Add a small module-local page surface pattern for the three modules.
   - Prefer feature-local components or repeated small class patterns rather
     than changing `_app.tsx`.
   - The surface should create visual separation from the sidebar through
     spacing, rounded corners, subtle background/ring/shadow, and internal
     padding.
   - Verify: ships/projects/contacts list and detail roots appear as standalone
     content blocks while the sidebar remains untouched.
2. Remove redundant separators inside those surfaces.
   - Replace pagination `border-t` with spacing or muted text grouping.
   - Remove dashed inner dividers in filter/card blocks where spacing already
     separates sections.
   - Keep semantic table structure but soften wrappers where possible.
   - Verify: no behavior or accessible table semantics regress.
3. Keep route and data behavior unchanged.
   - Do not change API hooks, permission gates, dialogs, masking logic, nested
     issue drawer routing, or FileBrowser owner anchoring.
   - Verify: focused route/component tests remain green.

## Risks

- A shared wrapper component could become a parallel layout system if placed too
  broadly. Keep it scoped to the three requested modules.
- Removing too many separators can reduce scanability for dense tables. Keep
  table row boundaries where they carry structure.
- Changing global `main` background would affect every module and is out of
  scope.

## Scope

In scope:

- `apps/web/src/app/routes/_app/ships/**`
- `apps/web/src/app/routes/_app/projects/**`
- `apps/web/src/app/routes/_app/contacts/**`
- Focused tests for changed components/routes if expectations need updates.

Out of scope:

- `apps/web/src/app/routes/_app.tsx`
- `apps/web/src/shared/components/app-sidebar*`
- Backend/API/schema changes
- Shared FileBrowser behavior
- New dependencies

## Alternatives

- Change the global app layout background and main padding. Rejected because it
  would affect all modules and conflict with the user's scoped feedback.
- Only remove divider classes. This reduces visual noise but does not address
  the sidebar/content connection.

## Annotations

- 2026-05-25 16:45 - Investigation completed; awaiting approval to implement.
- 2026-05-25 16:50 - User approved implementation by clarifying the target
  horizontal divider lines with a screenshot.
- 2026-05-25 17:05 - Implementation completed. Module roots now use standalone
  local surfaces, decorative table/card/filter separators were removed or
  softened, and `bun run check` passed.
