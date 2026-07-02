# REFACTOR-032 - `mountItemAttachmentRoutes` factory (dedupe 4x attachment quartet)

- Status: Completed
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3
- Created: 2026-07-02

## Summary

Upload / attach-from-drive / list / delete attachment handlers are near-identical (~150-250 lines
each) in `issue.routes.ts:602`, `procurement.routes.ts:482`, `document.routes.ts:683`,
`hr.routes.ts:325`; procurement's delete auth is ad-hoc (`procurement.routes.ts:622-626`) and
drifts from issue's unified gate. Mirror the existing `mountItemCommentRoutes` factory
(`item/comment.routes.ts`, permissions-callback style). See AUDIT-20260702-architecture.md → D5.

## Acceptance Criteria

- One factory mounts the quartet in all 4 modules with a host-supplied `permissions()` callback;
  procurement delete auth unified with the issue-style gate (admin ∥ manage-capability ∥ creator —
  match issue semantics, document any deliberate difference).
- Server-side drive READ re-assertion on attach-from-drive preserved in all hosts.
- Route paths, OpenAPI metadata, and response shapes unchanged (regenerate api docs/spec if
  describeRoute output shifts).
- Existing attachment tests pass; add factory-level tests for the permission callback.
- `bun run check` passes.

## Files in Scope

- New `apps/api/src/modules/item/attachment.routes.ts` (or similar)
- `issue.routes.ts`, `procurement.routes.ts`, `document.routes.ts`, `hr.routes.ts`

## Status Notes

- 2026-07-02: Completed — shared attachment route factory mounts the upload/attach-from-drive/
  list/delete quartet in all four host modules; procurement delete auth unified with the
  issue-style gate.
