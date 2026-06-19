# FEAT-038 Editable user name + upstream username sync + virtual-user email for seamless real-user binding

- **status**: completed
- **priority**: P1
- **owner**: pma
- **createdAt**: 2026-06-19 11:00
- **completedAt**: 2026-06-19 11:45

## Description

Make the user identity fields admin-manageable so a virtual user can be
seamlessly promoted to a real user when that person first logs in.

Requirements (from user):

1. `name` (姓名) is editable for BOTH virtual and real users.
2. `username` (用户名) is upstream-owned — synced from the IdP, not locally
   editable for real users.
3. A virtual user's `email` is editable.
4. Setting a virtual user's email to a future real user's address lets the
   existing OIDC take-over path bind that virtual row to the real identity on
   first login, with NO manual conversion step ("无缝绑定切换").

### Acceptance criteria

- Admin can edit `name` for any user; the edit survives subsequent IdP logins.
- Admin can edit a virtual user's `email` (uniqueness-checked); cannot edit a
  real user's `email`/`username`.
- On first OIDC login matching a virtual user by verified email, the row is
  rebound: `oauthSub` set, `isVirtual` cleared, `username` synced from upstream,
  locally-set `name` preserved; the user's id and project memberships are kept.
- No DB migration (all columns already exist).

## ActiveForm

Implementing editable user name, upstream username sync, and virtual-user email binding.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Builds on REFACTOR-025 / FEAT-020 (virtual users first-class) and the existing
`upsertUser` take-over/rebind path. See PLAN-089 for the design and decisions.

Completed 2026-06-19. `bun run check` EXIT 0 (lint, typecheck, all tests, build,
i18n, env-docs, api-docs, api-spec). No DB migration. Final behavior:

- `upsertUser` keys identity on `sub`; `name` and `username` are locally stable
  (never re-derived from the token on re-login or bind). Only email/avatar/last
  login track upstream for real users.
- Virtual binding: a verified upstream email plus a matching username claim
  (`preferred_username`/`username`) converts a virtual row in place
  (`isVirtual` cleared, oauthSub attached, local name+username preserved, id and
  memberships kept). Email-only match when the token has no username claim.
- `name` editable for all users; virtual `email`/`username` editable with
  uniqueness checks; real users' username/email stay IdP-owned (PATCH 400).
- Frontend: real users gain a name-edit dialog; virtual dialog adds an email
  field with a binding hint. New i18n keys in `users.json` (en+zh).
