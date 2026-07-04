# FEAT-049 - OpenAPI -> TS type generation pipeline for the web api layer

- Status: In Progress
- Plan: [PLAN-105](../plan/PLAN-105.md)
- Campaign: `l1-bithk-followups-20260704`
- Owner: L3
- Created: 2026-07-04

## Summary

The web api layer hand-mirrors backend view types in ~35 files (audit D10); the server already
generates an OpenAPI spec (`skills/bithk/references/api-spec.json`, 211 paths, drift-gated).
Add a generation step: spec -> TypeScript types consumed by `apps/web/src/shared/lib/api/*`.

## Acceptance Criteria

- `openapi-typescript` (latest stable, verified at npmjs.com at implementation time) added as a
  root/web devDependency, exact-pinned like existing deps.
- `gen:api-types` script emits a committed generated file (e.g.
  `apps/web/src/shared/lib/api/_generated/api-types.ts`) from the spec; a `check:api-types`
  drift mode is wired into root `check` (same pattern as check:api-docs/api-spec).
- Generated file is excluded from coverage and lint noise the same way `routeTree.gen.ts` is.
- A helper module exposes ergonomic aliases (e.g. `ApiViews["ProjectView"]`-style lookup or
  per-path response extraction) so consuming modules don't spell deep OpenAPI paths.
- One module (projects) migrated as the reference adoption; `bun run check` passes.

## Files in Scope

- root `package.json`, `apps/web/package.json`, new script under `scripts/` or `apps/web/scripts/`,
  `apps/web/src/shared/lib/api/_generated/*`, `apps/web/src/shared/lib/api/projects.ts`,
  `apps/web/vitest.config.ts` / `eslint.config.ts` (exclusions), docs/reference note.
