# CHORE-007 - Bring apps/api/scripts under typecheck

- Status: Completed (2026-08-28)
- Plan: -
- Depends on: [REFACTOR-039](REFACTOR-039.md) (merge first — the seed script is rewritten by it)
- Created: 2026-08-28

## Goal

`apps/api/tsconfig.json` includes only `src/**/*.ts` and `tests/**/*.ts`, so
everything under `apps/api/scripts/` — the seed script and its payload
loaders, `gen-api-docs.ts`, `gen-api-spec.ts` — is invisible to
`bun run typecheck`. This is the structural gap that let three stale seed
references survive a green quality gate during PLAN-108: the code only broke
when the script was actually executed.

Root cause, not symptom: the gap is the tsconfig include list, not the
individual stale references.

## Scope

- Add `scripts/**/*.ts` to the api tsconfig include list.
- Fix whatever type errors that surfaces in the scripts themselves. If a
  script legitimately needs looser settings, give it its own tsconfig rather
  than weakening the api project's.
- Audit the sibling packages for the same gap (`apps/web`, root `scripts/`)
  and report — extend the fix only where it is the same one-line include.

## Verification

- `bun run typecheck` covers `apps/api/scripts/**` — prove it by introducing a
  deliberate type error there, seeing typecheck fail, then reverting.
- `bun run check` EXIT 0.
- `bun run seed` still green (the scripts are executed, not just compiled).
