# PLAN-105 - Deferred follow-ups from the 2026-07-02 architecture assessment

- Status: In Progress
- Tasks: [REFACTOR-036](../task/REFACTOR-036.md), [DOC-001](../task/DOC-001.md),
  [FEAT-049](../task/FEAT-049.md), [REFACTOR-037](../task/REFACTOR-037.md)
- Campaign: `l1-bithk-followups-20260704` (FEAT-049/REFACTOR-037 only; REFACTOR-036 and DOC-001
  are executed directly by the interactive session)
- Created: 2026-07-04
- Source: [../audit/AUDIT-20260702-architecture.md](../audit/AUDIT-20260702-architecture.md)
  (Out-of-scope list), user approval 2026-07-04

## Context

Three items were deliberately deferred from PLAN-104 pending user decisions, now made:
migration collapse (no concurrent campaigns remain), an ADR recording HR's flat module-gate
RBAC as deliberate (no row-level tightening), and OpenAPI→TS type generation for the web api
layer (replacing hand-mirrored view types, audit finding D10). A fourth deferred item (macOS CI
leg) already shipped as FIX-058. File size-cap enforcement was explicitly declined (S3 imposes
no limit); the 3 pre-existing expect-reject e2e tests remain red until revisited.

## Scope

In:
- REFACTOR-036: collapse migrations 0000-0008 into a fresh 0000 baseline (drizzle-kit generated).
- DOC-001: ADR-014 documenting HR flat module-gate RBAC (doc-only, no behavior change).
- FEAT-049: `gen:api-types` pipeline (OpenAPI spec → generated TS types for apps/web) + drift
  gate in `check`.
- REFACTOR-037: adopt the generated types across `apps/web/src/shared/lib/api/*`, removing
  hand-mirrored view types.

Out:
- Any HR authorization behavior change.
- File size-cap enforcement.

## Acceptance Criteria

- Each task's own acceptance criteria met; `bun run check` passes after each landing.
- Collapse: fresh DB migrate+seed works; `db:generate` after collapse produces no drift;
  migration replay test green.
- Typegen: generated types are committed, drift-gated, and the api layer compiles against them
  with no `any` regressions.

## Status Notes

- 2026-07-04: Plan created; REFACTOR-036 + DOC-001 direct, FEAT-049 + REFACTOR-037 via BKD
  campaign `l1-bithk-followups-20260704`.
