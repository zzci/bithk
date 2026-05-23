# Full-Feature Test & Hardening Report

Campaign: `l1-phcsb7fu-20260523223531` — full-feature test + production
hardening. This report is the lane G (final integration) consolidation, written
after lanes A–F, the three web lanes (F1/F2/F3) and lane H (fail-closed 404
existence policy) merged to `main`.

Date: 2026-05-23. Runtime: Bun 1.3.14 monorepo (`apps/api`, `apps/web`,
`packages/shared`).

## Final gate status

| Gate | Result | Detail |
|---|---|---|
| `bun run check` | **PASS** | lint (0 errors, 4 pre-existing warnings) + typecheck + all unit/integration tests + build + `check:i18n` + `check:env-docs` + `check:api-docs` |
| `bun run test:e2e` | **PASS** | 75 tests across 26 files, 0 fail, live dex + API stack |

Test totals from the passing `bun run check`:

| Suite | Files | Tests | Result |
|---|---|---|---|
| `@app/api` (unit + integration) | 71 | 1004 | 0 fail |
| `@app/web` (Vitest) | 51 | 321 | 0 fail |
| `@app/shared` (Vitest) | 1 | 13 | 0 fail |
| e2e (live stack) | 26 | 75 | 0 fail |

## Backend coverage (per module)

`@app/api` overall: **83.29% functions / 92.04% lines**. Per-module averages
(from the `bun test --coverage` rollup):

| Module | % Funcs | % Lines |
|---|---|---|
| account | 80.7 | 89.8 |
| audit | 80.3 | 97.6 |
| backup | 100.0 | 93.2 |
| cron | 96.8 | 96.8 |
| document | 78.9 | 95.8 |
| drive | 86.9 | 96.0 |
| file | 64.0 | 76.9 |
| issue | 62.5 | 98.2 |
| item | 80.7 | 99.6 |
| policy | 68.1 | 84.8 |
| procurement | 56.1 | 98.3 |
| project | 86.8 | 99.4 |
| search | 90.0 | 100.0 |
| settings | 66.7 | 100.0 |
| share | 93.3 | 100.0 |

Lines coverage is uniformly high (76–100%). Lower *function* percentages
(file/procurement/settings/policy) are mostly unexercised error branches and
optional adapter hooks; line coverage on those same files stays ≥76%.

## Frontend coverage + raised floors

`@app/web` combined coverage after the F1/F2/F3 UI suites merged:

| Metric | Actual | New floor | Old floor |
|---|---|---|---|
| Statements | 29.94% | **29** | 14 |
| Branches | 25.04% | **24** | 10 |
| Functions | 30.15% | **29** | 12 |
| Lines | 30.05% | **29** | 14 |

The vitest coverage floors in `apps/web/vitest.config.ts` were raised to sit
just below the new actuals, locking in the UI-suite gains (the previous
~14/12/14/10 placeholders predate F1–F3). **No floor was lowered.** This
resolves the long-standing web coverage gate concern — the gate now reflects
real product coverage rather than a token minimum, and is enforced by
`bun run check`.

## Web coverage resolution

Raised, not waived: the `apps/web` branch-coverage floor moved from 10% to
24% (and lines/statements/functions to 29%), matching the post-F1/F2/F3
actuals. No `docs/decisions/` floor-drop entry was needed.

## Cross-lane defects found & fixed during the campaign

Defects surfaced and fixed by lanes A–H while hardening each module. All were
fixed in code with regression tests; no gate was weakened.

| Defect | Module / lane | Fix |
|---|---|---|
| **LIKE wildcard injection** — search terms with `%` / `_` / `\` matched unintended rows | user search (A), document (B), drive/file (C), project/issue/item (D) | Escape `%`/`_`/`\` in terms and emit an explicit `ESCAPE` clause on every `LIKE` predicate (commits `15ca35b`, `5eb657c`, `f688d10`, `3b4fecf`) |
| **client-ip CIDR mask** — trusted-proxy ranges mis-parsed, so the wrong source IP was trusted/logged | middleware (A) | Correct CIDR mask computation in `getClientIp` trusted-proxy resolution (`616d9b2`) |
| **drive quota cache** — stale per-owner usage cache let uploads bypass the quota | drive/file (C) | Fix the quota cache invalidation so usage reflects committed writes (`3b4fecf`) |
| **document soft-delete cascade** — deleting a parent left orphaned children/relations readable | document (B) / drive (C) | Cascade soft-delete across the subtree and drop authz tuples (`966e71a`, `3b4fecf`) |
| **share `expiresAt` validation** — a free-form expiry string parsed to `NaN`, making an "expiring" link never expire | share (B/C) | Reject non-ISO-8601 expiry at the boundary with `z.iso.datetime()`; `isExpired` is now reliable (`a572ae8`) |
| **procurement amount `min(0)`** — negative procurement amounts were accepted | procurement (D) | Add a non-negative amount guard + free-transition contract test (`68f0b5b`, decision 002) |
| **comment route existence disclosure** — shared comment routes returned 403 for non-relationship callers, leaking existence | shared comment routes (A) | Fail-closed 404 for no-relationship comment reads (`15ca35b`) |
| **document/drive read existence disclosure** — no-access reads returned 403, leaking that the resource exists | document + drive read authz (H) | Fail-closed 404 for no-relationship reads; 403 reserved for capability-denial on visible resources (`539a782`, decision 003) |
| **documents page a11y + error-state** — missing roles/labels and unhandled query-error UI on the documents/drive pages | web (F) | Add accessible roles/labels + explicit error states; harden test setup (`7b15d22`) |
| **duplicate / revoked share leakage** — duplicate shares per entry allowed; revoked shares still listed | drive share (C) | Forbid duplicate shares per entry; drop revoked shares from per-entry / sent / links lists (`b796b8c`, `9e61f49`, `27789a5`) |

### Decision records produced

- **001 — drive preview stack** (`docs/decisions/001-drive-preview-stack.md`): the markdown/code preview + editor stack reused across drive viewer, file creation and public share pages.
- **002 — procurement free transitions** (`docs/decisions/002-procurement-free-transitions.md`): the 5-state procurement lifecycle permits free status transitions, locked by contract tests.
- **003 — fail-closed 404 existence policy** (`docs/decisions/003-fail-closed-404-existence-policy.md`): no-relationship reads return 404 (existence never disclosed); capability-denial on a visible resource returns 403.

## Integration defects found & fixed (lane G)

All breakage was **stale e2e tests pointed at API surfaces that A–H replaced**.
Fixes corrected the tests to the current (intended) surface — no test was
weakened and no production gate was lowered.

1. **Issue e2e on removed global routes (5 failing tests).**
   `POST /api/issues` returned 403 because the issue module is now
   project-only (lane D / REFACTOR-002). Re-pointed
   `tests/e2e/modules/issue/{issues,attachments,comment-attachments}.test.ts`
   at `/api/projects/:projectId/issues[...]`, creating a project first via a
   new shared helper `tests/e2e/lib/project.ts` (admin creates the project and
   bypasses membership).

2. **Drive sharing e2e on removed per-module routes (4 failing tests).**
   `POST /api/drive/entries/:id/shares` returned 404 because drive sharing
   moved to the unified share module (lane B/C). Rewrote
   `tests/e2e/modules/drive/shares.test.ts` to use
   `POST/GET /api/shares/drive_entry/:id`, `/api/shares/{received,sent,links}`,
   `PATCH/DELETE /api/shares/:shareId`, and the public token endpoints
   `GET /api/shared/:token` + `POST /api/shared/:token/download`.

3. **Drive read assertions vs. fail-closed 404 policy (2 failing tests).**
   A non-owner read and a read of a permanently-deleted entry now return 404
   (not 403) under lane H / decision 003. Updated the assertions and comments
   in `tests/e2e/modules/drive/entries.test.ts`.

4. **Missing live search coverage (gap, not a failure).** Global search — a
   listed critical flow — had no live-stack e2e. Added
   `tests/e2e/modules/search/search.test.ts` (cross-type hit by shared token,
   empty-query empty buckets, 401 auth gate) and registered the `search`
   module in `tests/e2e/run.ts`.

## Browser smoke

**Not executed — environment limitation, not a product defect.** The dev stack
(`bun run dev`) is running and serving requests internally, but it is only
reachable through the nsl gateway (`https://bit.a.fr.ds.cc`), which returns
`403 Forbidden` to every client from this sandbox (verified with both `curl`
and a real Chromium session via `agent-browser`); the vite (`:5000`) and API
(`:3000`) ports are network-isolated from the sandbox, and the production OIDC
provider requires interactive credentials the harness does not supply for
browser flows.

Equivalent coverage of the critical flows is provided by the **live-stack e2e
suite** (dex-backed OIDC login + every module), which is green at 75/75:

| Critical flow | Live e2e coverage |
|---|---|
| Login (OIDC) | `modules/account/auth` + dex login in every suite |
| Document create + public link | `modules/document/*`, `modules/drive/shares` (public link create → password download → exhaustion → revoke) |
| Drive upload | `modules/drive/entries`, `modules/drive/shares` (multipart upload) |
| Project / issue create | `modules/issue/*` (project-scoped CRUD, comments, attachments) |
| Global search | `modules/search` (new) |

## Security-hardening summary

- **Fail-closed 404 existence policy (decision 003).** Reads with no
  relationship to the resource return **404** (existence is never disclosed);
  capability-denial on a resource the caller *can* see returns **403**.
  Implemented by lane A (shared comment routes → 404) and lane H
  (document/drive/etc. read authz → 404; audited across project/item/share/
  file). The drive e2e assertions in this report were updated to match.
- **Procurement free-transition contract (decision 002).** The 5-state
  procurement lifecycle permits free status transitions, locked in by
  contract tests.
- Pre-existing safeguards remain green: sentinel guards on example secrets,
  CSRF middleware, `__Secure-` session cookies, PKCE + state binding,
  parameterized queries with LIKE-wildcard escaping in search.

## Files changed (lane G)

- `apps/web/vitest.config.ts` — raised coverage floors to 29/29/29/24.
- `tests/e2e/lib/project.ts` — new shared project-creation helper.
- `tests/e2e/modules/issue/{issues,attachments,comment-attachments}.test.ts`
  — re-pointed at project-scoped routes.
- `tests/e2e/modules/drive/{shares,entries}.test.ts` — unified share API +
  fail-closed 404 assertions.
- `tests/e2e/modules/search/search.test.ts` — new live search suite.
- `tests/e2e/run.ts` — registered the `search` module.
- `docs/changelog.md` — Unreleased entry.

## Remaining issues / follow-ups

- Browser smoke remains unrun in CI/sandbox until the dev stack is reachable
  without the nsl gateway 403 (or a headless OIDC fixture is wired for the
  browser, as the e2e harness already does for the API).
- `apps/api` function coverage on `file` / `procurement` / `policy` /
  `settings` is comparatively low (56–68%); line coverage on the same files is
  ≥76%. Worth a future unit-test pass on their error branches, not a release
  blocker.
- Build emits chunk-size (>500 kB) and one ineffective-dynamic-import warning
  for the markdown editor — non-blocking, tracked for a later code-split pass.
