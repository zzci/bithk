# CHORE-008 - Bring the repository root under typecheck

- Status: In Progress
- Plan: -
- Depends on: [CHORE-007](CHORE-007.md) (the audit that found this gap)
- Created: 2026-08-28

## Goal

The repository root has no typecheck at all. The root `tsconfig.json` declares
no `include`, and the root `package.json` `typecheck` script is
`bun run --filter '*' typecheck`, i.e. workspaces only. 62 TypeScript files are
therefore never typechecked:

- `eslint.config.ts`
- 14 files under `scripts/` — `check-i18n`, `clean`, `clean-unused-i18n`,
  `dev-all`, `dev-dex`, `find-unused-i18n`, `gen-api-types`, `gen-env-docs`,
  `hash-password`, `package`, `rebrand`, `scripts/ci/validate-lode-release.ts`,
  and `scripts/lib/i18n-scan.ts` with its co-located test
- 47 files under `tests/` — the e2e suites, fixtures, and smoke tests

CHORE-007 closed the same class of gap for `apps/api/scripts` (and, with it,
`apps/web`'s config files), which is what surfaced this one.

## Scope

This is **not** the one-line `include` that fixed the two workspaces, which is
why it was split out rather than folded into CHORE-007. A throwaway scan
config proved it:

- `"types": ["bun"]` fails with `TS2688` — `@types/bun` is an `apps/api`
  devDependency, not a root one.
- Without it, 139 errors appear, dominated by environment artifacts: 29x
  `TS2868` "Cannot find name 'Bun'", `TS2339` on `import.meta.dir` /
  `import.meta.env`, and 46x `TS2307` module-resolution failures because
  `tests/` imports across into `apps/*` and needs their path aliases.

Closing it needs a dedicated root tsconfig — its own type dependencies, path
aliases, and `include` scoping that does not re-pull `apps/**` — plus a new
root typecheck step wired into `bun run check`.

## Verification

- Root-level TypeScript files are covered by `bun run check` — prove it by
  introducing a deliberate type error under `scripts/` and watching the gate
  fail, then reverting.
- `bun run check` EXIT 0.
