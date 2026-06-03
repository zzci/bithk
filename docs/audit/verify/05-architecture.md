# V5 — Architecture & Type-Safety Remediation Verification

**Campaign:** `l1-w6c655lo-verify-20260603031707` (VERIFICATION-ONLY — no source changes)
**Verifier lane:** V5 (`bkd/lnqh8825`)
**Base:** main @ `146d991` (worktree HEAD)
**Scope:** REFACTOR-AUDIT-013, REFACTOR-AUDIT-014, FIX-AUDIT-026, REFACTOR-AUDIT-015
**Source of truth:** `docs/audit/remediation-backlog.md` §3c + `docs/audit/architecture.md` Areas C/D/E + `docs/audit/testing.md` A1.

---

## REFACTOR-AUDIT-013 — Eliminate route non-null `!` clusters

- **Verdict:** PARTIAL (mechanism genuinely in place + bulk removed; two residual clusters survive within the finding's cited scope)
- **Method:** Read `shared/lib/types.ts` (ProtectedEnv def) + `shared/lib/route-params.ts` (typed param helper); grep for the three cited patterns (`c.get("user")!`, `c.req.param(...)!`, `policyContext(c)!`) across production `.ts` (excluding tests); enumerated every `*.routes.ts` still constructing `new Hono<AppEnv>()`.
- **Evidence — what was genuinely fixed:**
  - `apps/api/src/shared/lib/types.ts:30-33` — `ProtectedEnv` exists; `Variables.user` is **non-optional** (`Omit<AppEnv["Variables"], "user"> & { user: User }`). This removes the root cause (optional `user?` in `AppEnv`) for any router mounted as a `ProtectedEnv` sub-app.
  - `apps/api/src/shared/lib/route-params.ts:18` — typed `requireParam<E>(c, name)` helper exists; **0** real residual `c.req.param(...)!` in production (the lone grep hit at `route-params.ts:8` is a JSDoc comment, not an assertion).
  - **20** `*.routes.ts` files now construct `new Hono<ProtectedEnv>()` (document, drive, item, project, ship, issue, procurement, contact, cron, audit, settings, users, groups, tag, search, system, policy, backup export/restore, ship.worklist). The high-density clusters the audit named — `document.routes.ts` (was 39 `!`), `drive.routes.ts` (was 29) — now read `c.get("user")` as `User` directly. Reduction from the audit's ~200 sites to ~25 residual (~87%).
  - The four route files still on `new Hono<AppEnv>()` that carry **no** `user!` are correctly excluded by design — `account.routes.ts`, `auth/auth.routes.ts`, `backup.routes.ts`, `share/share.public.routes.ts` mix public/unauthenticated routes (login, OAuth callback, export-via-token, public share). So the migration was deliberate, not blanket.
- **Evidence — residuals (NOT fixed):**
  - `apps/api/src/modules/share/share.routes.ts:75` — this router runs `router.use("*", authRequired)` (every route is protected) and is mounted under `routes/protected.ts:52`, yet it is still `new Hono<AppEnv>()`. It retains **6** `c.get("user")!` (lines 87, 92, 97, 110, 142, 161). It is a clean ProtectedEnv candidate that was skipped.
  - `apps/api/src/modules/drive/drive.share-adapter.ts:18` — **1** `c.get("user")!` in `actorOf(c: Context<AppEnv>)` (adapter helper, less trivially convertible than a route sub-app).
  - `policyContext(c)!` — **18** residual sites across `document/document.routes.ts`, `document/document.share-adapter.ts`, `drive/drive.routes.ts`. Root: `modules/policy/middleware.ts:31` `policyContext<E extends RequestEnv>(c): PolicyContext | null` returns `| null` even for protected callers (it re-reads `c.get("user")` through the optional-`user` `RequestEnv` constraint), so ProtectedEnv does not narrow it. No `requirePolicyContext()` helper (analogous to `requireParam`) was added to absorb this cluster.
  - Total residual: `c.get("user")!` = **7**, `policyContext(c)!` = **18**, `c.req.param(...)!` = **0**.
- **Note:** The backlog Action explicitly scopes this to "eliminating the **bulk** of the assertions," and the bulk is genuinely gone via a real (non-superficial, non-bypassable) mechanism. I mark PARTIAL rather than VERIFIED-FIXED because a cited fully-protected router (`share.routes.ts`, listed with 10 hits in architecture.md Area C) was not migrated and a whole named pattern-cluster (`policyContext(c)!`, 18) persists. L1/L2 may legitimately accept this as within the "bulk" intent — flagging for that decision, not asserting a regression.

---

## REFACTOR-AUDIT-014 — Single `runWrite()` helper for Drizzle `.changes`

- **Verdict:** VERIFIED-FIXED
- **Method:** Read the helper def; grep `runWrite` usage across services; grep `as unknown as RunResult` / `as unknown as { changes }` and all `as unknown as` in production to confirm the cast is centralized and no Drizzle write-result double-cast survives elsewhere.
- **Evidence:**
  - `apps/api/src/db/index.ts:99-114` — typed `RunResult` interface + `export function runWrite(stmt: () => void): RunResult { return stmt() as unknown as RunResult }`. The unsafe `as unknown as RunResult` cast is confined to this **single** spot (line 113), documented as "this single audited spot."
  - `runWrite` is imported and used across the cited service files: `item/item.service.ts:152,177`, `document/document.service.ts:261`, `contact/contact.service.ts:304`, `contact/contact-category.service.ts:84`, `project/project.service.ts:449,484,798`, `project/project.categories.ts:88`, `project/project.global-categories.ts:84`, `audit/retention.ts:34`. Matches the ~11 service files architecture.md Area D listed.
  - **0** residual `as unknown as RunResult` / `as unknown as { changes }` outside `db/index.ts`. The remaining `as unknown as` hits are unrelated and out-of-scope: `logger.ts:102,234` (pino proxy / reopenable dest — already noted low/accepted in architecture.md Area F), `backup/restore.routes.ts:138` + `restore.service.ts:156` (backup payload parsing), `shared/test/route-harness.ts:30,83` (test-only). None is a Drizzle `.run().changes` write-result reinterpretation.
- **Note:** The double-cast pattern is genuinely centralized and the per-service duplication is removed — root cause addressed, not superficially.

---

## FIX-AUDIT-026 — Bring HTTP layer under the local gate

- **Verdict:** VERIFIED-FIXED
- **Method:** Read root `package.json` scripts (the `check` pipeline); confirmed `check:routes` is wired into `check`; enumerated the `*.routes.test.ts` files the filter selects; confirmed the shared route-harness exists.
- **Evidence:**
  - `package.json:35` — `"check": "bun run lint && bun run typecheck && bun run test && bun run check:routes && bun run build && bun run check:i18n && bun run check:env-docs && bun run check:api-docs"` — `check:routes` is a member of the gate (between `test` and `build`).
  - `package.json:36` — `"check:routes": "bun run --filter @app/api test .routes.test"` — runs Bun's test runner filtered to the `.routes.test` path substring.
  - **26** `*.routes.test.ts` integration suites exist under `apps/api/src/modules/**` (account, auth, users, audit, backup×3, contact, cron, file, issue×2, item×2, policy, procurement, project, search, settings, share×2, ship×3, system, tag) — i.e., the filter selects a real, broad HTTP-layer harness, not an empty match.
  - `apps/api/src/shared/test/route-harness.ts` — shared route-test harness (full `Config`, no-op `Logger`, mounted Hono app with `db`/`config`/`logger` seeded + user/session seeding) backs these suites.
  - `apps/api/bunfig.toml` — documents that `**/*.routes.ts` are coverage-excluded because they are exercised by route/e2e tests (system-of-record for HTTP behaviour), consistent with the gate now running the route harness.
- **Note:** The HTTP/route layer is genuinely under `bun run check` now (this is exactly the strengthening the campaign recorded). Real, non-bypassable.

---

## REFACTOR-AUDIT-015 — Decide & enforce module-barrel boundary

- **Verdict:** N/A-BY-DECISION (document-keep decision honored)
- **Method:** Read `docs/decisions/009-module-barrels.md`; counted `modules/*/index.ts` barrels; verified the side-effect claim (`registerBackupContribution` count) the decision rests on; confirmed the decision's explicit "do NOT add `eslint no-restricted-imports`" was honored.
- **Evidence:**
  - `docs/decisions/009-module-barrels.md` EXISTS — status `accepted`, dated 2026-06-03, review-by 2026-12-01, explicitly cross-references finding REFACTOR-AUDIT-015. Records the **document-keep** decision: keep all 19 barrels as the route-wiring/module-**registration** surface (import-time side effects), accept deep cross-module imports, and record the finding's "half-applied / droppable barrel" framing as incorrect.
  - **19** barrels intact at `apps/api/src/modules/*/index.ts` (account, audit, backup, contact, cron, document, drive, file, issue, item, policy, procurement, project, search, settings, share, ship, system, tag).
  - **15** of the 19 barrels call `registerBackupContribution(...)` at module load — matches the decision's "15 of the 19" claim, substantiating the load-bearing-registration rationale (a dropped barrel = a silently missing backup section).
  - **No** `no-restricted-imports` / `no-internal-modules` rule in `eslint.config.ts` — matches the decision's deliberate choice to NOT funnel imports through the barrel.
- **Note:** This is a decision item; verified the decision was honored (barrels kept + rationale recorded + no lockdown rule), not that code was deleted. Correct N/A-BY-DECISION.

---

## Summary

| Item | Verdict |
|------|---------|
| REFACTOR-AUDIT-013 | **PARTIAL** |
| REFACTOR-AUDIT-014 | VERIFIED-FIXED |
| FIX-AUDIT-026 | VERIFIED-FIXED |
| REFACTOR-AUDIT-015 | N/A-BY-DECISION |

**Non-VERIFIED items:** REFACTOR-AUDIT-013 — PARTIAL. ProtectedEnv + `requireParam` are genuinely implemented and the bulk of assertions removed (~200 → ~25, ~87%), but residuals remain within the cited scope: `share/share.routes.ts` (a fully-protected `authRequired` router) was not migrated to `ProtectedEnv` and retains 6 `c.get("user")!`; and 18 `policyContext(c)!` assertions persist because `policyContext()` still returns `PolicyContext | null` for protected callers (no `requirePolicyContext` helper). The backlog Action scoped this to "the bulk," so L1/L2 may accept the residual as in-scope — surfaced for that call, not flagged as a regression. All other assigned items are VERIFIED-FIXED / N/A-BY-DECISION.
