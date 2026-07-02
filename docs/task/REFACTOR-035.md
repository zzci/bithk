# REFACTOR-035 - Invert search dependencies via `registerSearchSource` registry

- Status: Completed
- Plan: [PLAN-104](../plan/PLAN-104.md)
- Campaign: `l1-bithk-arch-20260702084717`
- Owner: L3
- Created: 2026-07-02

## Summary

`search/search.service.ts:1-9` imports 6 domain modules' service internals (drive, drive
team-directory, document, issue, project, ship) — the only infra→domain dependency inversion in
the codebase. Mirror the registry pattern of `backup/registry.ts` / `tag/tag.registry.ts`. See
AUDIT-20260702-architecture.md → D8.

## Acceptance Criteria

- `search` exposes `registerSearchSource({ key, search(ctx, query) })`; each searchable module
  registers its source from its own `index.ts` (import side effect, same weave as backup).
- Search fan-out (`Promise.all`), result shapes, per-source authorization filtering, and ranking
  unchanged.
- `search` module no longer imports any domain module internals (grep-verified).
- Existing search tests pass; add a registry test (duplicate key throws, unregistered module
  absent from results).
- `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/search/*` (new registry), and one registration block in each of
  `drive/index.ts`, `document/index.ts`, `issue/index.ts`, `project/index.ts`, `ship/index.ts`.

## Status Notes

- 2026-07-02: Completed — searchable modules now self-register via `registerSearchSource`; the
  search module no longer imports domain internals; fan-out, filtering, and ranking unchanged.
