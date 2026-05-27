# FEAT-014 Default cover placeholders for projects and ships

- Status: Done
- Plan: -
- Updated: 2026-05-27

## Goal

Show a default placeholder cover image for projects and ships that have no
cover, so list cards and detail headers never render an empty band.

## Scope

- Add two default cover SVGs (`src/assets/cover-project.svg`,
  `cover-ship.svg`) and a shared `CoverImage` component that renders the cover
  when set, else the kind-specific default (always an `<img>` so the Card's
  first-child full-bleed styling applies).
- Use `CoverImage` at the project/ship list cards, detail headers, and the two
  cover-field editor previews.

## Verification

- `bun run check` passes.
- Projects/ships without a cover show the default illustration everywhere.
