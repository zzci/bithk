# REFACTOR-031 - Single module manifest for nav-gate / PAT-scope / prefix matching

- Status: Completed
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3
- Created: 2026-07-02

## Summary

Three near-identical prefix→module maps exist: `shared/modules.ts:20` (`MODULES`),
`module-gate.ts:69` (`UNGATED_PREFIXES`), `account/tokens/scope.ts:32` (`TOKEN_MODULES`), with two
copies of the same first-match-wins matcher (`moduleForPath` vs `tokenModuleForPath`). See
AUDIT-20260702-architecture.md → D2/D9.

## Acceptance Criteria

- One manifest (e.g. `shared/module-manifest.ts`): per-module `{ prefixes, navKey?, tokenScopeKey,
  ungated? }`; `MODULES`, `UNGATED_PREFIXES`, `TOKEN_MODULES` derived from it; single shared
  `moduleForPath` matcher.
- Existing coverage tests (`module-gate.test.ts`, `scope.test.ts`) still enumerate the real
  `protectedRoutes()` and pass unchanged in spirit (adjust imports only).
- PAT scope semantics, module concealment (404) behavior, and admin short-circuit unchanged.
- `bun run check` passes.

## Files in Scope

- `apps/api/src/shared/modules.ts`, `apps/api/src/shared/middleware/module-gate.ts` (or its home),
  `apps/api/src/modules/account/tokens/scope.ts`, new manifest file, their tests.

## Status Notes

- 2026-07-02: Completed — single shared module manifest now derives `MODULES`,
  `UNGATED_PREFIXES`, and `TOKEN_MODULES` with one shared `moduleForPath` matcher; gate/scope
  semantics unchanged.
