# REFACTOR-030 - Route-table reuses real route factories (kill the drifted mount copy)

- Status: Completed
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3
- Created: 2026-07-02

## Summary

`apps/api/scripts/lib/route-table.ts:44-70` hand-duplicates the mounts of `routes/protected.ts` +
`routes/public.ts` and has drifted: `/admin/storage/*` (4 routes, `file/storage.routes.ts`) is
missing from `docs/reference/api-routes.md` and `skills/bithk/references/api-spec.json`. Third
occurrence of this bug class (FIX-045). See AUDIT-20260702-architecture.md → D1/D2.

## Acceptance Criteria

- `buildApiApp()` composes the real `publicRoutes()`/`protectedRoutes()` factories instead of a
  hand-maintained mount list (or, if infeasible, a lockstep test asserts route-table output equals
  the real routers' route set, same technique as `scope.test.ts:78`).
- Regenerated `api-routes.md` + `api-spec.json` include the storage admin routes; `check:api-docs`
  and `check:api-spec` pass.
- `docs/develop/module/playbook.md` updated to list ALL wiring registries (module-gate/PAT
  scope/route-table or their successor), noting which are test-enforced.
- `bun run check` passes.

## Files in Scope

- `apps/api/scripts/lib/route-table.ts`, `apps/api/scripts/gen-api-docs.ts`, `gen-api-spec.ts`
- `docs/reference/api-routes.md`, `skills/bithk/references/api-spec.json` (regenerated)
- `docs/develop/module/playbook.md`

## Status Notes

- 2026-07-02: Completed — route-table now composes the real `publicRoutes()`/`protectedRoutes()`
  factories; regenerated api-routes.md/api-spec.json include the storage admin routes; playbook
  lists all wiring registries.
