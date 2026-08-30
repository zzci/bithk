# TEST-002 - Stale and unreachable end-to-end specs

- Status: Proposed
- Plan: -
- Created: 2026-08-29

## Goal

CHORE-008 brought `tests/**` under typecheck and, in doing so, surfaced two
runtime-level problems that typechecking cannot catch:

- `tests/smoke/routes.spec.ts` still exercises a `/ships` route. PLAN-108
  deleted that route tree; the case types fine and fails when run.
- `tests/e2e/contacts.spec.ts` and `tests/e2e/projects.spec.ts` have **no
  runner**. The only Playwright config is `tests/smoke/playwright.config.ts`
  (`testDir: "."`, so it covers `tests/smoke` only), and `tests/e2e/run.ts`
  runs the bun tests under `tests/e2e/modules/*`. `contacts.spec.ts` also
  asserts a `columnheader "Contact person"` that no longer exists in
  `apps/web`.

Fixtures drifted precisely because nothing runs them.

## Scope

- Delete or update the `/ships` smoke case to match the section model.
- Decide per orphaned spec: wire it into a runner, or delete it. Do not leave
  a spec on disk that nothing executes — that is the state that produced this
  task.
- If wiring them in, state which command runs them and make that command part
  of a gate someone actually runs.

Out of scope: broadening e2e coverage, and the pre-existing e2e failures
unrelated to these two files.

## Verification

- Every `*.spec.ts` under `tests/` is reachable from a documented command.
- That command passes for the files this task touches.
- `bun run check` EXIT 0.
