# REFACTOR-020 — Virtual users first-class: backend (users.isVirtual + members userId-only)

- Status: Completed (merged into bkd/fto2m2se)
- Plan: [PLAN-066](../plan/PLAN-066.md)
- Campaign: l1-75ymcfnr-vuser-20260603200111
- Owner: L2 fto2m2se dispatch → L3-1
- Created: 2026-06-03

## Summary

Backend core of the virtual-users-as-first-class-rows refactor:

- `users.isVirtual` integer boolean (default 0) + migration (`bun run db:generate`).
- Virtual user admin CRUD (create/list/update/delete) under `/account/users`,
  `adminRequired`; synthetic `oauthSub="virtual:<id>"`, `email="<username>@virtual.local"`,
  `role="user"`, `status="active"`, `isVirtual=1`.
- Global username uniqueness: reject a `username` already used by ANY user
  (real or virtual) on create/update.
- `GET /account/visible-users` → real-only (`status=active AND isVirtual=0`).
- NEW `GET /account/assignable-users` (authRequired) → active real+virtual with
  `isVirtual` flag (member-add picker source).
- Project members: `userId` NOT NULL, `displayName` column DROPPED; member
  add/update REQUIRE `userId`; `composeMember` resolves `name` + `isVirtual`
  from the `users` row; remove the displayName/promote paths.
- Tests: virtual user create; global username uniqueness (reject dup vs real or
  virtual); member assignment to a virtual user; update existing member/service
  tests that used `displayName`.

## Files in scope

- `apps/api/src/modules/account/users/schema.ts`
- `apps/api/src/modules/account/users/users.routes.ts`
- `apps/api/src/modules/account/users/users.service.ts`
- `apps/api/src/modules/account/users/users*.test.ts`
- `apps/api/src/modules/project/schema.ts`
- `apps/api/src/modules/project/project.routes.ts`
- `apps/api/src/modules/project/project.service.ts`
- `apps/api/src/modules/project/project.routes.test.ts`, `project.service.test.ts`
- `apps/api/drizzle/**` (generated migration)

## Status notes

- 2026-06-03: Created + dispatched as L3-1 (backend first; L3-2/L3-3 frontend
  depend on it).
- 2026-06-03: **L3-1 (fxm1cqys) MERGED** into bkd/fto2m2se (--no-ff, merge
  6ca3e1f; L3 commit 2abcf5f). users.isVirtual (+forward migration
  0001_equal_stephen_strange.sql recreating project_members w/o display_name +
  user_id NOT NULL); createVirtualUser (oauthSub=virtual:<id>,
  email=<username>@virtual.local, role=user/active/isVirtual=1) +
  updateVirtualUser/deleteVirtualUser w/ global username uniqueness (409);
  admin POST/PATCH/DELETE /account/users (virtual) + GET /account/assignable-users
  (auth, real+virtual) + visible-users real-only; ProjectMemberView drops
  displayName, adds name+isVirtual (users join); member add/update userId-only.
  Post-merge `bun run check` EXIT 0 (api 1450/0, build/i18n[26 heuristic-unused
  non-blocking]/env/api-docs green; web vitest @milkdown teardown flake only).
  Forced out-of-scope edits (disjoint from frontend lanes): auth.service.ts
  (+isVirtual:false ×2), issue.test.ts (DDL bootstrap + 2 obsolete virtual tests
  rewritten), docs/reference/api-routes.md (regenerated). Dev DB must be reset on
  next boot (destructive recreate). L3-2 (0iipd539) + L3-3 (r0qlbvyo) dispatched
  (working).
