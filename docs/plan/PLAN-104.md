# PLAN-104 - Architecture remediation (2026-07-02 architecture assessment)

- Status: Completed
- Tasks: [REFACTOR-030](../task/REFACTOR-030.md), [REFACTOR-031](../task/REFACTOR-031.md),
  [REFACTOR-032](../task/REFACTOR-032.md), [REFACTOR-033](../task/REFACTOR-033.md),
  [REFACTOR-034](../task/REFACTOR-034.md), [REFACTOR-035](../task/REFACTOR-035.md),
  [FIX-054](../task/FIX-054.md), [FIX-055](../task/FIX-055.md), [FIX-056](../task/FIX-056.md),
  [FIX-057](../task/FIX-057.md), [UI-028](../task/UI-028.md), [UI-029](../task/UI-029.md),
  [TEST-001](../task/TEST-001.md)
- Campaign: `l1-bithk-arch-20260702084717` (BKD three-tier L1/L2/L3)
- Created: 2026-07-02
- Source: [../audit/AUDIT-20260702-architecture.md](../audit/AUDIT-20260702-architecture.md)

## Context

The 2026-07-02 architecture assessment (findings D1-D15) found a structurally sound codebase with
debt concentrated in module-wiring registries (one already drifted), oversized route
files/components, cross-module boilerplate duplication, and quality-gate waste. This plan
remediates all actionable findings. Each task maps to one L3 lane under a BKD L2 dispatcher; the
L2 runs in worktree `bkd/{L2_ID}`; L1 merges to local main after gates are green (no push).

## Waves (conflict-driven sequencing)

- **Wave 1 (parallel, file-disjoint):** REFACTOR-030 (scripts/lib + docs), FIX-054 (policy),
  FIX-055 (contact), FIX-056 (root pipeline/CI), FIX-057 (schemas + migrations),
  REFACTOR-035 (search + module index.ts registrations), UI-028 (web api layer + hooks).
- **Wave 2 (after wave 1 merges):** REFACTOR-031 (shared/modules + module-gate + scope.ts),
  REFACTOR-032 (issue/procurement/document/hr routes), REFACTOR-034 (auth/cron/users routes,
  document cascade, drive purge), UI-029 (web components). REFACTOR-032 and REFACTOR-034 both
  touch `document.routes.ts` — serialize or coordinate.
- **Wave 3 (last):** REFACTOR-033 (mechanical okJson/pagination/audit sweep across all route
  files — only after all route-file surgery lands), TEST-001 (coverage gaps, after behavior
  settles).

## Acceptance Criteria

- Each task's own acceptance criteria met.
- `bun run check` passes after every L3 merge and on the final combined tree.
- Migrations generated via drizzle-kit only (no hand-authored migration files).
- No behavior change outside each task's stated scope; generated docs/spec regenerated where
  route metadata changes.

## Out of scope (needs decision)

- OpenAPI→TS type generation for `apps/web` (design choice; UI-028 only tightens the current
  hand-mirrored layer).
- HR flat-RBAC: ADR vs row-level payroll scoping (product decision).
- Migration collapse and index-naming unification (defer until concurrent campaigns finish).
- macOS CI matrix leg demotion (billing decision).

## Status Notes

- 2026-07-02: Plan created from AUDIT-20260702-architecture. Dispatch via BKD campaign
  `l1-bithk-arch-20260702084717`; this session acts as interactive L1.
- 2026-07-02: Completed — all 13 tasks (REFACTOR-030..035, FIX-054..057, UI-028/029, TEST-001)
  implemented and merged into the campaign integration branch across three waves; gates green
  after every merge.
