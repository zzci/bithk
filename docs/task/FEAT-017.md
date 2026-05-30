# FEAT-017 — GitHub-style project role permissions (read / comment / write)

- Status: Proposed (analysis complete — awaiting approval)
- Plan: [PLAN-042](../plan/PLAN-042.md)
- Campaign: l1-xlhyvzyz-roleperm-20260530223736
- Owner: L2 dispatch (analysis), implementation TBD after approval
- Created: 2026-05-30

## Summary

Extend the per-project capability model with read-only / comment / read-write
tiers modeled on GitHub repository roles, and make the issue / comment / drive
routes honor view + comment capabilities (today they gate on bare membership).

## Scope (after approval)

- Backend: add `project.view`, `comment.create`, `files.manage`; remove
  `procurement.view`; add a `kind` discriminator to `project_roles`; seed two
  implicit system roles (Owner + Guest) plus Reader/Commenter/Writer presets;
  change `deleteRole` to auto-demote a deleted custom role's members to Guest
  (drop the "in use" rejection); update gates in issue, comment, procurement,
  and drive routes; data migration for the cap rename + Member→Guest.
- Frontend: mirror capabilities, derive view/comment/files flags, gate write
  affordances, add a role preset quick-fill, i18n.

## Out of scope

- Per-module view/comment granularity (Option B) — rejected in PLAN-042.
- A seeded "Maintainer" tier (members/roles management stays Owner-only by
  default; still assignable via custom roles).

## Status notes

- 2026-05-30: Investigation + proposal written (PLAN-042). Awaiting L1/user
  approval before any implementation.
- 2026-05-30: Extended per L1 — two implicit system roles (Owner + Guest) and a
  delete-fallback that auto-demotes a deleted custom role's members to Guest;
  'Member' maps to Guest, read-only is the separate Reader preset. Still
  analysis-only, awaiting approval.
