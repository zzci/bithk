# PLAN-114 Product acceptance follow-up

- Status: completed
- Approved: 2026-09-05 (user requested continued fixes after the acceptance gaps)
- Task: [FIX-076](../task/FIX-076.md)

## Context and scope

PLAN-113 repaired six confirmed persistence and recovery defects. Existing browser
smoke tests cover two mocked pages; broader product acceptance remains unproven.

1. Exercise login, navigation, document and drive persistence with the real API
   and isolated local data; check narrow viewports and keyboard access.
2. Reproduce discovered defects, add focused regressions, and repair minimally.
3. Measure bounded local concurrency and exercise release/backup recovery paths.
4. Run focused checks, the quality gate, and relevant end-to-end tests.

Reuse existing test tooling and UI primitives. No dependency upgrades, remote
deployment, or Git publication. Local measurements cannot establish production
capacity, actual mobile-device compatibility, or deployment-specific rollback.

## Results

- Investigation started; prior repairs remain in the working tree.
- RED: real browser tests reproduce drive actions outside the 390px viewport
  and hashed Vite entry scripts served with `no-cache`. Login/reload and keyboard
  skip navigation passed. Wrap toolbar groups without hiding create actions and
  recognize the actual Vite hash format in static cache headers.
- RED: typing body content and immediately creating a document persists an
  empty body. Milkdown's listener debounces changes by 200ms and cancels pending
  notifications on destroy. Publish changed document snapshots synchronously,
  matching the existing source editor contract; retain debounced UI listeners.
- GREEN: five browser tests pass against the production build and real API:
  login/reload and keyboard skip navigation, mobile folder creation and menu
  focus restoration, static cache headers, immediate document create/edit/save,
  and immediate WYSIWYG/source switching. The automatic server fixture also
  passes all five tests and stops its isolated API on completion.
- `bun run check` passed: 2256 API tests, 1034 web tests, lint (17 existing
  warnings, zero errors), type checks, builds, and documentation/spec drift checks.
  Follow-up browser fixture type checks and CI YAML parsing passed.
- API E2E: 109 passed, including full seeded backup round-trip and cross-schema
  import defaults. No new dependencies or migrations.
- Bounded load on the shared local container: 500 document writes and 1000 mixed
  document/tree reads at concurrency 20, all successful. Write P95 203ms, read
  P95 209ms; 176 writes/s and 155 reads/s. This is a small local dataset and
  shared hardware, not a production capacity claim.
- `bun run package` passed. The extracted release passed migration check,
  offline export/import to a fresh data directory, row-for-row comparison of
  users (1), items (504), document details (504), and drive entries (1), SQLite
  foreign-key/integrity checks, and restored server readiness/SPA checks.
- Added `bun run test:browser` and a browser acceptance CI step. The runner
  starts an isolated single-user API; optional `BROWSER_CDP_URL` supports an
  external Chrome runtime. Browser verification used Chrome 149 in an isolated
  existing container image because the local Chromium runtime lacks fonts and
  has broken automated input. No application workaround was added for it.
- Final local diff review and whitespace checks passed. Test APIs, browser
  container, forwarding processes, and owned tmux sessions were stopped.
  Changes remain uncommitted; no push or deployment was performed.

## Acceptance limits

Desktop Chrome and a 390px viewport were exercised, including navigation through
documents, drive, projects, contacts, and HR. This is targeted critical-flow
coverage, not every role or workflow. Real mobile devices, browser OAuth login,
assistive technology/contrast audits, production-scale sustained load, and actual
lode deployment upgrade/rollback still require their respective environments.
The local release recovery exercise does not establish those deployment guarantees.
