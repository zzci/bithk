# FEAT-017 — GitHub-style project role permissions (read / comment / write)

- Status: In Progress (L1 PROCEED 2026-05-30 — per-module model)
- Plan: [PLAN-042](../plan/PLAN-042.md)
- Campaign: l1-xlhyvzyz-roleperm-20260530223736
- Owner: L2 dispatch
- Created: 2026-05-30

## Summary

Make project permissions **per-module** (issue / procurement / files each
independently view/comment/manage), modeled on GitHub repository roles, and make
the issue / comment / drive routes honor the new view + comment capabilities
(today they gate on bare membership).

## Scope

- Backend: 12 per-module caps (`issue.view/comment/manage`,
  `procurement.view/comment/manage`, `files.view/manage`, + `categories.manage`,
  `members.manage`, `roles.manage`, `project.manage`); `kind` discriminator on
  `project_roles`; seed Owner + Guest (implicit) + Reader/Commenter/Writer
  presets; `deleteRole` auto-demotes a deleted custom role's members to Guest
  (drop "in use" rejection); gates in issue, comment, procurement, drive routes;
  migration Member→Reader + Guest backfill.
- Frontend: mirror 12 caps, per-module role flags, gate affordances, Owner/Guest
  locked rendering, preset quick-fill, i18n.

## Out of scope

- `files.comment` — drive files have no comment surface (verified).
- A seeded "Maintainer" tier (members/roles/project management stays Owner-only
  by default; still assignable via custom roles).

## Status notes

- 2026-05-30: Investigation + proposal written (PLAN-042). Awaiting L1/user
  approval before any implementation.
- 2026-05-30: Extended per L1 — two implicit system roles (Owner + Guest) and a
  delete-fallback that auto-demotes a deleted custom role's members to Guest.
- 2026-05-30: **L1 PROCEED** with granularity change to **PER-MODULE** caps (12).
  PLAN-042 rewritten accordingly. Implementing via DAG B1 → B2‖B3‖B4 → F1,
  each L3 worktree-only. Flag: Member→Reader vs →Guest contradiction in the
  PROCEED message resolved to Reader (see PLAN-042 §5); awaiting L1 confirm.
