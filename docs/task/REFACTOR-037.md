# REFACTOR-037 - Adopt generated API types across the web api layer

- Status: In Progress
- Plan: [PLAN-105](../plan/PLAN-105.md)
- Campaign: `l1-bithk-followups-20260704`
- Owner: L3 (after FEAT-049 merges)
- Created: 2026-07-04

## Summary

Replace the hand-mirrored view types in `apps/web/src/shared/lib/api/*.ts` (~35 files) with the
generated types from FEAT-049, following the reference adoption in `projects.ts`.

## Acceptance Criteria

- Every `shared/lib/api/*.ts` module's request/response types derive from the generated types
  (type aliases per module are fine; no hand-written duplicates of server view shapes remain).
- Frontend-only types (form state, UI helpers) stay local — do not force them into the spec.
- Where the generated spec type and the previous hand type disagree, the SPEC wins; if the spec
  itself is wrong (missing field the server actually returns), report it back instead of
  hand-widening (that is a backend describeRoute bug).
- No runtime behavior change; existing api-layer tests pass; `bun run check` passes.

## Files in Scope

- `apps/web/src/shared/lib/api/*.ts` (+ their tests where type imports change).
