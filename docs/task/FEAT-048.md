# FEAT-048 Rework overview page into a real workbench

- Status: Completed
- Plan: [PLAN-103](../plan/PLAN-103.md)
- Owner: local-session
- Updated: 2026-07-02

## Goal

The app-level overview page (`/_app/overview`) currently renders only a welcome
line and two static navigation tiles (Projects, Documents) that duplicate the
sidebar. It carries no information.

Rework it into a workbench that surfaces the user's actual work:

- **Favorites (user-curated pins)**: a standalone per-user favorites table
  (`user_favorites`: userId + targetType + targetId) in its own module — no
  changes to project/issue/procurement schemas or routes. Users star projects
  and issues (work orders) to pin them on the overview. Rationale: nearly all
  projects are `active`, so an auto "active projects" list would not
  differentiate; curation does.
- Open procurements across accessible projects (non-terminal statuses).
- The user's open issues (work orders assigned to them) across those projects.

Procurements and issues are currently project-scoped only; a small aggregate
endpoint is needed. All aggregation must be fail-closed to the caller's
project membership and per-project capabilities.

## Out of Scope

- Any change to existing module schemas (favorites live in their own table).
- Any change to the per-project overview tab.

## Acceptance Criteria

1. Overview shows the caller's favorites; star/unstar is available on the
   projects list, project detail, and issue detail; per-user, survives
   reload; favorites the caller can no longer view are never returned.
2. Overview shows the caller's open issues and open procurements across
   accessible projects via a new aggregate endpoint; a user without membership
   or the relevant capability in a project never sees that project's rows.
3. Users without the `projects` module see a quick-nav fallback, not errors.
4. Empty states render cleanly; i18n keys exist in en + zh.
5. API tests cover scoping (member vs non-member, capability gate);
   web tests cover section rendering. `bun run check` passes.
