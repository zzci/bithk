# FEAT-020 — Admin Users: create / edit / delete virtual users

- Status: Completed (merged into bkd/fto2m2se)
- Plan: [PLAN-066](../plan/PLAN-066.md)
- Campaign: l1-75ymcfnr-vuser-20260603200111
- Owner: L2 fto2m2se dispatch → L3-2
- Created: 2026-06-03

## Summary

Admin Users page (`apps/web/src/app/routes/_app/admin/users/index.lazy.tsx`)
gains virtual-user management on top of the existing OIDC-provisioned real-user
list:

- "Create virtual user" action: form with `username` + `name` (no login
  fields). POST `/account/users` (the new L3-1 endpoint).
- Virtual badge in the user list (driven by the new `isVirtual` field on the
  list payload).
- Edit a virtual user (name + username) and delete a virtual user
  (`PATCH` / `DELETE /account/users/:id`). Real users keep only the existing
  role/status controls.
- i18n en+zh parity for new strings (virtual user, create virtual user,
  virtual badge, edit/delete).

## Files in scope

- `apps/web/src/app/routes/_app/admin/users/index.lazy.tsx`
- `apps/web/src/locales/en/users.json`
- `apps/web/src/locales/zh/users.json`

## Dependencies

- L3-1 (REFACTOR-020) backend: `isVirtual` on list/detail, POST/PATCH/DELETE
  `/account/users` for virtual users.

## Status notes

- 2026-06-03: Created (planned, deps=L3-1). File-disjoint from L3-3.
- 2026-06-03: **L3-2 (0iipd539) MERGED** into bkd/fto2m2se via cherry-pick of its
  own commit bd7ee14 → 37f8fa3 (clean; 3 files: admin/users/index.lazy.tsx +
  users.json en/zh). Cherry-pick used (not full branch merge) because BKD cut the
  L3 worktree from a NEWER main already carrying 3 foreign campaigns
  (roledup/ovratio/roleui = PLAN-063/064/065); cherry-picking the L3's own commit
  keeps bkd/fto2m2se scoped to ONLY this campaign. UI +isVirtual; virtual badge;
  Create/Edit/Delete virtual-user dialogs (POST/PATCH/DELETE /account/users);
  i18n virtual.* + field.username/name (en+zh). Post-cherry-pick `bun run check`
  EXIT 0 (all green). Completed.
