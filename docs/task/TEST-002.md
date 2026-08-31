# TEST-002 - Stale and unreachable end-to-end specs

- Status: In Progress
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

Decision (2026-08-31): **delete**, do not wire in.

- Remove the `/ships` entry from `tests/smoke/routes.spec.ts` (line 29) and the
  `/ships` special case further down (around line 55). The rest of that file
  still covers live routes and stays.
- Delete `tests/e2e/contacts.spec.ts` (97 lines) and
  `tests/e2e/projects.spec.ts` (123 lines) outright. Nothing runs them, their
  fixtures have drifted past the current UI, and resurrecting them would mean
  rewriting assertions against a UI that changed under PLAN-108 — new work
  disguised as maintenance. If Playwright coverage of those flows is wanted
  later, it should be written against the current UI as its own task.
- Leave `tests/e2e/run.ts` and `tests/e2e/modules/**` alone: those bun tests
  do run and are a different thing from the orphaned Playwright specs.

Out of scope: broadening e2e coverage, and the pre-existing e2e failures
unrelated to these two files.

## Verification

- Every remaining `*.spec.ts` under `tests/` is reachable from a documented
  command — enumerate them against the Playwright config's `testDir` and say
  which command runs each.
- `bun run smoke` passes with the `/ships` entry gone.
- No dangling imports or helpers left behind by the two deleted files
  (`git grep` for anything they were the sole consumer of).
- `bun run check` EXIT 0 — note that `tests/**` is inside the typecheck target
  since CHORE-008, so deletions must not orphan a type reference.
