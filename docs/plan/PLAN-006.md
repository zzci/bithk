# PLAN-006 — Flatten `portal` out of frontend routing

- **Status:** Done
- **Task:** [REFACTOR-001](../task/REFACTOR-001.md)
- **Updated:** 2026-05-23

## Goal

Remove the `_app/portal/` route grouping. Modules mount at the root; the
dashboard becomes `/overview`. Admin and the root redirect are untouched.

## Steps

1. `git mv` `_app/portal/*` up into `_app/`; portal `index.{tsx,lazy.tsx}`
   become `overview.{tsx,lazy.tsx}` → verify: files relocated, intra-portal
   relative imports still resolve.
2. Rewrite route-id strings `"/_app/portal/..."` → `"/_app/..."`; the two
   overview files use `"/_app/overview"` → verify: grep finds no
   `_app/portal` outside `routeTree.gen.ts`.
3. Rewrite navigation/link paths `/portal/x` → `/x` and bare `/portal` →
   `/overview` across routes, login, totp, denied, admin, sidebar registry,
   nav configs, `isNavActive`, drive-preview alias imports → verify: grep
   finds no `"/portal` literal.
4. Backend: `auth.routes.ts` default `${base}/portal` → `${base}/overview`;
   `drive.permission.ts` `/portal/drive` → `/drive` → verify: grep clean.
5. Regenerate `routeTree.gen.ts` via vite → verify: tree contains
   `/overview` and root-level module routes, no `portal`.
6. `bun run typecheck` + `bun run lint` → verify: clean.

## Decision

Initially route-only. Per follow-up ("全部修改") the rename was extended to
remove the `portal` concept everywhere: `NavArea` `portal` → `overview`, nav
key/label, the `portal` i18n namespace (`portal.json` → `overview.json`),
`denied.backToPortal` → `backToOverview`, and `shared/components/portal/`
(document-tree utils) → `shared/components/documents/`. React DOM portals
(`createPortal`, `*.Portal`) are unrelated and left untouched.
