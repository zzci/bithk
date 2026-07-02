# REFACTOR-033 - Shared route-helper sweep: okJson, parseTagIds, pagination, auditFromCtx

- Status: Completed
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3 (wave 3 — run only after all other route-file surgery merges)
- Created: 2026-07-02

## Summary

Mechanical dedup: `okJson`/`okListJson`/`errorJson` copy-pasted in 31 route files; `parseTagIds`
×4; `shared/lib/pagination.ts` adopted by only 3 modules while ~10 hand-roll clamping with
divergent max limits; audit actor/ip/logger boilerplate at 63 sites. See
AUDIT-20260702-architecture.md → D6.

## Acceptance Criteria

- `okJson`/`okListJson`/`errorJson` live once in `shared/lib/` (openapi helpers); all copies
  deleted.
- `parseTagIds` shared; tag-query zod schemas unified.
- Hand-rolled pagination call sites adopt the shared helper + one shared paginated-meta zod
  schema; per-endpoint max limits preserved as explicit args (no silent limit changes).
- `auditFromCtx(c, entry)` helper added in the audit module; call sites migrated mechanically
  (keep per-site action/resource fields; ip/userAgent handling unified).
- No route behavior/response-shape change; `bun run check` passes; regenerate api docs/spec if
  spec output shifts.

## Files in Scope

- `apps/api/src/shared/lib/` (openapi/pagination helpers), `modules/audit/` (helper), and the
  mechanical sweep across `apps/api/src/modules/**/ *.routes.ts` + affected services.

## Status Notes

- 2026-07-02: Completed — `okJson`/`okListJson`/`errorJson`, `parseTagIds`, pagination clamping,
  and `auditFromCtx` deduped into shared helpers; route behavior and response shapes unchanged.
