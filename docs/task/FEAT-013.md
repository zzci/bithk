# FEAT-013 Base project inherits the ship cover image

- Status: Done
- Plan: -
- Updated: 2026-05-27

## Goal

When a project is a ship's base project and has no cover of its own, display the
ship's cover image as a fallback.

## Scope

- `project.service.ts`: resolve a project's `coverImageUrl` as own cover, else
  (when it is a ship's base project) the ship's cover. Batch-aware for the list.
- No new endpoint. The inherited URL points at the ship's `ship_cover`
  reference; the file content route authorizes base-project members via the
  existing `ship_cover` permission hook, so reuse is permission-safe.

## Verification

- `bun run check` passes.
- A base project with no own cover shows its ship's cover; setting an own cover
  overrides it; a non-base project is unaffected.
