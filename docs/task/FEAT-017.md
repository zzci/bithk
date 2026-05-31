# FEAT-017 — GitHub-style project role permissions (read / comment / write)

- Status: Completed (2026-05-31 — all lanes merged to main, `bun run check` green)
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
- 2026-05-31: **DONE.** All 5 lanes merged to main (B1 4e4d66d, B2 712176c,
  B3 af098bd, B4 c5f8305, F1 177558b + test-fix 9cc35f4). Verified on main:
  `bun run check` EXIT=0 — 1191 API + 535 web + 13 shared tests pass. F1 had
  reported its web-test failures as "environment issues"; on main they were
  real (7 issue-tab tests needed `canManage`) and were fixed (9cc35f4).
  Outstanding: L1 to confirm Member→Reader (vs →Guest) mapping — 1-line flip if
  changed.
- 2026-05-31: **F2** (b7ef6f1, merged a0cbe65) — replaced the role editor's
  per-capability Switch grid with a **per-module 3-tier RADIO selector** (Issue:
  None/View/Comment/Manage; Procurement: same; Files: None/View/Manage), per L1's
  "3-tier radio role editor" spec; admin caps stay independent toggles; new
  `radio-group.tsx` on `@base-ui` (no Radix). Verified on main: `bun run check`
  EXIT=0 — 1191 API + 544 web + 13 shared pass.
- 2026-05-31: **Confirmed Member→Reader** (L1) — no flip.
- 2026-05-31: **Backfill fix (critical).** B1's migration only added the `kind`
  column — it did NOT backfill the 30 existing projects (verified on the live DB:
  all 60 roles `kind=NULL`, no Guest, no presets, Member not→Reader). Added an
  idempotent boot-time `backfillProjectRoles(db)` in `project.roles.ts`, wired
  into `bootstrap()` after `createDb` (runs on server boot / migrate-on-boot, not
  in unit tests): per project it sets the Owner role `kind='owner'` **and
  normalizes its caps to the full 12-cap set**, inserts a Guest role if missing,
  renames the empty `Member` role → `Reader` (preserving member assignments) with
  the `*.view` caps, and inserts any missing Reader/Commenter/Writer presets.
  Self-healing (no whole-project skip sentinel) so a partially-migrated project
  converges on the next boot. Merges: backfill eec1cb7, owner-cap self-heal
  0ffa44e (→ main 35d7726). Verified LIVE on the real dev DB (`data/db/app.db`)
  after dev-server restart: boot logged `scanned=30 touched=30 inserted=90` then
  `touched=30 inserted=0` (owner-cap upgrade) then steady `touched=0 inserted=0`
  (idempotent); sqlite shows 30 owner + 30 guest roles, every Owner on the full
  12-cap set, 0 orphan `kind=NULL` system roles, every project has all 3 presets.
  `bun run check` EXIT=0 (1199 API + 544 web + 13 shared). Agent worktrees cleaned.
