# Audit — Testing Posture & Gaps

**Dimension:** testing (coverage posture, untested critical paths, brittle tests, missing endpoint integration tests)
**Scope:** `apps/api` + `apps/web` + `packages/*` + `tests/`
**Methods:**
- M1 — test-vs-source inventory (`find` + ripgrep import-graph: which source files are imported by **no** unit/e2e test; alias `@/…` and relative `./…` imports both resolved).
- M2 — targeted source reads to confirm each candidate gap is real vs. covered indirectly through a barrel / route harness / e2e (rules out false positives).
- M3 — coverage-config & CI-gate review (`apps/api/bunfig.toml`, `apps/web/vitest.config.ts`, `bunfig.toml`, `.github/workflows/ci.yml`).
- M4 — brittleness scan (real-clock `Bun.sleep`, `windowMs:1`, `Date.now()` ordering; `.skip/.only/.todo` sweep).

**Test suite size:** API unit = 94 files, Web = 90 files, e2e API = 27 files, Playwright browser specs = 4 (mock-API smoke). No `.skip`/`.only`/`.todo` anywhere (good).

### Totals by severity
| severity | count |
|----------|-------|
| critical | 0 |
| high     | 0 |
| medium   | 4 |
| low      | 9 |

**Headline:** the API unit suite is genuinely strong (83% line / 74% func baseline, enforced ≥80/70 in CI) and the critical money/auth/permission *engine* layers are well covered. The real gaps are at **HTTP boundaries that the unit gate deliberately excludes** combined with **e2e not running inside `bun run check`**, plus a **much weaker web floor (29%)**. No finding rises to high given the dev-phase posture and the e2e safety net.

> **Pre-existing context (NOT counted as new findings):** (1) web branch-coverage floor — note: `apps/web/vitest.config.ts` now enforces lines/stmts/funcs ≥29, branches ≥24 (the older "~3.99% under a 4% floor" note is stale; the floor was raised). (2) `-project-issue-panel.test.tsx` `@milkdown/ctx` teardown race is known-flaky.

---

## A. Coverage gate / posture

### A1 — e2e suite is not part of `bun run check`; route HTTP layer is excluded from the unit gate → route regressions pass the local gate
- `package.json:35` — severity: medium — confidence: high
- rationale: `check = lint && typecheck && test && build && …` runs only the unit `test`; `test:e2e` (`package.json:33`) is a separate script run in an isolated CI job (`.github/workflows/ci.yml:205`). Meanwhile `apps/api/bunfig.toml` excludes `**/*.routes.ts` from coverage ("e2e is the system-of-record for HTTP behaviour"). The two halves never meet in one command: a developer's green `bun run check` proves nothing about HTTP handlers, and any `*.routes.ts` without an e2e is unguarded locally.
- suggested action: add an e2e (or fast route-harness) step to `check`, or document that `check` is unit-only and require `test:e2e` before merge of any `*.routes.ts` change.

### A2 — Web coverage floor (29% lines / 24% branches) is ~3× weaker than API (80/70); the bulk of route components are untested
- `apps/web/vitest.config.ts:60` (thresholds block) — severity: medium — confidence: high
- rationale: 90 web test files cover 274 source files; the floor (lines 29 / branches 24) leaves ~70% of hand-written SPA logic unguarded. Several **pure-logic** units that are cheap to test carry no test at all (see D-group). Method M1.
- suggested action: ratchet the web floor up incrementally; prioritise pure-logic hooks/utils first (D1) which give the most coverage per line of test.

---

## B. API critical-path gaps (untested or thinly tested)

### B1 — Generic file HTTP endpoints have no integration test (unit or e2e)
- `apps/api/src/modules/file/file.routes.ts:25` (`GET /files/:id/metadata`) and `:63` (`GET /files/:id/content`) — severity: medium — confidence: high
- rationale: `file.service.ts`, `gc.ts`, `permission.ts`, `storage/local.ts` are well unit-tested (`file.test.ts`), but the **HTTP layer** (mounted live at `routes/protected.ts:59`, consumed by the web client for covers/downloads) is exercised by no test. Attachment download/inline-disposition is tested only through the *attachment* routes (`tests/e2e/modules/issue/attachments.test.ts:46`), not these generic `/files` handlers. The permission check + `buildDownloadResponse` content-disposition/inline branch (`:94`) at the boundary is unverified. Methods M1+M2.
- suggested action: add an e2e (or route-harness) covering `/files/:id/metadata` and `/files/:id/content` for owner / non-owner / missing-id / `?inline` cases.

### B2 — Drive↔file ownership ACL hook is registered but its `canRead`/`canDelete` logic is never asserted
- `apps/api/src/modules/drive/drive.file-permission.ts:6` (`canRead`) and `:20` (`canDelete`) — severity: medium — confidence: medium
- rationale: this side-effect-registered hook is the access gate deciding whether an actor may read/delete a `drive_entry`-backed file (admin bypass + owner-match). No test imports the file and no test drives a file fetch through a `drive_entry` ref, so the ownership predicate (and the admin-bypass branch) is unverified. Security-relevant. Method M1+M2.
- suggested action: unit-test `canRead`/`canDelete` for owner / non-owner / admin against seeded `drive_entries`.

### B3 — HTTP authorization wiring (route→action bindings) is validated only by e2e, not at unit level
- `apps/api/src/modules/policy/middleware.ts:152` (`policyMiddleware`), `:86` (`requirePermission`), `apps/api/src/modules/policy/route-registry.ts:14` (binding table) — severity: low — confidence: high
- rationale: the Zanzibar engine and policy service are thoroughly unit-tested, but the middleware that maps each route+method to a permission action is imported by only 3 test files (one `*.routes.test.ts`). Enforcement is covered by e2e 403 assertions across ~10 modules (`tests/e2e/modules/**`), so this is a unit-depth gap, not an enforcement hole — but it shares the A1 risk (e2e not in `check`).
- suggested action: add a focused unit test asserting representative `route-registry` bindings resolve to the expected action, so mis-bindings fail without a full e2e run.

### B4 — PKCE seal/open failure & tamper branches untested
- `apps/api/src/modules/account/auth/pkce-secret.ts:41` (`openPkceVerifier`) — severity: low — confidence: high
- rationale: AES-256-GCM seal/open of OAuth code-verifiers. The happy path is exercised by the dex-backed e2e login (`tests/e2e/modules/account/auth.test.ts`), but the failure branches — `openPkceVerifier` returning `undefined` on a tampered ciphertext / wrong auth-tag / `v1:` scheme mismatch — are untested. A dedicated `__resetPkceSecretForTests` hook (`:59`) was written but no test uses it. Security-relevant edge behaviour.
- suggested action: unit-test round-trip + corrupted-input → `undefined` + scheme-version rejection (the reset hook already exists for this).

### B5 — `parsePageQuery` (pagination parser behind every list endpoint) has no isolated unit test
- `apps/api/src/shared/lib/pagination.ts:23` — severity: low — confidence: high
- rationale: powers offset/limit parsing for all list routes; exercised only indirectly through route tests, so boundary cases (negative page, over-max limit, non-numeric, defaults) aren't pinned. Cheap, high-value unit. Method M1.
- suggested action: add a small table-driven unit test for clamp/default/invalid inputs.

---

## C. Brittle / flaky tests (real-clock dependence)

### C1 — Sub-10ms `Bun.sleep` used to force createdAt ordering
- `apps/api/src/modules/item/comment.test.ts:176` (`Bun.sleep(2)`), `apps/api/src/modules/item/pin.routes.test.ts:214` (`Bun.sleep(5)`) — severity: low — confidence: medium
- rationale: 2–5 ms real sleeps to guarantee distinct/monotonic timestamps for ordering assertions. Under a loaded CI runner (or coarse timer resolution) two rows can collide, making order non-deterministic. Method M4.
- suggested action: order by a deterministic key (explicit sequence/id) or inject monotonic timestamps instead of sleeping.

### C2 — Rate-limit window test uses `windowMs: 1`
- `apps/api/src/shared/middleware/rate-limit.test.ts:37` — severity: low — confidence: medium
- rationale: a 1 ms window relying on `Bun.sleep(10)` to expire is timing-fragile; safe today but a thin margin. Method M4.
- suggested action: widen the window and assert expiry via an injectable clock rather than wall time.

### C3 — Fixed `Bun.sleep` waits for async flush / retention ordering
- `apps/api/src/shared/lib/logger.test.ts:23` (`Bun.sleep(50)` ×6), `apps/api/src/modules/audit/retention.test.ts:127` (`Bun.sleep(10)` ×5) — severity: low — confidence: low
- rationale: fixed sleeps to await async log flush / order audit rows add wall-time and can flake under load; not currently observed failing. Method M4.
- suggested action: await a completion signal/promise rather than a fixed delay where feasible.

---

## D. Web — untested logic & components

### D1 — Pure-logic hooks/utils with no test (cheapest coverage wins)
- `apps/web/src/shared/hooks/use-debounce.ts:1`, `apps/web/src/shared/lib/tag-utils.ts:1`, `apps/web/src/shared/lib/status-colors.ts:1`, `apps/web/src/shared/lib/errors.ts:1`, `apps/web/src/shared/components/share/use-share.ts:1`, `apps/web/src/shared/components/resource/use-attachment-upload.ts:1` — severity: low — confidence: high
- rationale: framework-light logic (debounce, tag normalization, status→color mapping, error normalization, share/upload hook state) imported by no test. These are deterministic and trivial to cover, and would lift the weak web floor (A2) efficiently. Method M1.
- suggested action: add unit tests for each; start with `tag-utils`, `status-colors`, `errors`, `use-debounce`.

### D2 — `pagination-footer.tsx` untested (also the source of the recurring i18n `procurement.total` churn)
- `apps/web/src/shared/components/pagination-footer.tsx:1` — severity: low — confidence: medium
- rationale: a shared list-footer used across modules with no test; repeated i18n-key regressions on this file (per project history) indicate it would benefit from a render/i18n-key test. Method M1.
- suggested action: add a render test asserting page math + that referenced i18n keys exist.

### D3 — Playwright `*.spec.ts` are mock-API browser smoke, not full-stack e2e
- `tests/e2e/projects.spec.ts:6` (route interception with `fixtures/*`), `tests/smoke/routes.spec.ts:1` — severity: low — confidence: high
- rationale: these intercept API routes and return fixtures, so they validate UI rendering against *mocked* responses — they do not exercise the real backend. Useful, but they do not close the A1 HTTP-boundary gap and shouldn't be counted as integration coverage.
- suggested action: keep as UI smoke; rely on `tests/e2e/modules/**` (live API) for backend contract coverage and document the distinction.

---

## E. Migrations

### E1 — Compiled-binary embedded-migration path is validated only manually
- `apps/api/src/db/embedded-migrations.ts:11` — severity: low — confidence: high
- rationale: every test boots via `createDb` → `runMigrations`, so the **on-disk** drizzle path (`apps/api/drizzle/0000–0003`) is forward-applied on each run (implicit, strong coverage). But the **embedded `Map`** path used only inside the `bun build --compile` binary is excluded from coverage and has no automated test — a packaging/migration break would surface only at release runtime. Forward-apply + per-migration data-preservation are otherwise untested by policy (dev-phase: DB reset freely), which is acceptable. Methods M1+M3.
- suggested action: add a compile-path smoke (boot the compiled binary, assert schema present) to CI's docker/build job, or a test that asserts the embedded map is populated post-`compile`.

---

## Notes / non-findings (verified covered, listed to prevent re-flagging)
- `procurement.service.ts` / `.routes.ts` — **well covered** (`procurement.service.test.ts` 24.6K, `procurement.routes.test.ts` 24.9K). `amount`/`quantity` are stored fields, not derived; there is no server-side money arithmetic to leave untested.
- `cron/actions/{shell,http-request,log-cleanup,soft-delete-cleanup}/executor.ts` — all covered via their `index` barrel (`shell/index.test.ts`, `http-request/index.test.ts`, `soft-delete-cleanup/index.test.ts`, and `cron.test.ts:27` runs `logCleanupAction.execute`). M1 flagged them only because tests import the barrel, not the executor file.
- `issue/references.{service,routes}.ts` — covered: mounted via `mountIssueReferenceRoutes` and exercised by `references.routes.test.ts`.
- `ship.equipment.service.ts`, `account/{users,groups}` services — covered via their route/service tests despite no exact-name sibling.
- `shared/middleware/auth.ts` — no dedicated unit test, but exercised by the dex-backed e2e auth flow and every authed route test through the harness.
