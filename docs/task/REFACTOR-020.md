# REFACTOR-020 — Virtual users first-class: backend (users.isVirtual + members userId-only)

- Status: In Progress
- Plan: [PLAN-063](../plan/PLAN-063.md)
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
