# BITHK Architecture Assessment — 2026-07-02

**Campaign:** `l1-bithk-arch-20260702084717` · **Base:** `main` @ `49157032` (FEAT-048)
**Mode:** READ-ONLY assessment. Remediation is tracked by [PLAN-104](../plan/PLAN-104.md).
**Scope:** whole-system architecture — API core wiring, all 22 `apps/api` modules (platform + domain),
`apps/web` (React 19 + Vite + TanStack), data layer (Drizzle/SQLite), engineering infrastructure
(check pipeline, CI, scripts, docs system).

## Method

Six dimensions assessed in parallel by independent read-only agents, each citing `file:line` evidence,
then deduplicated by root cause: (1) API core & module wiring contract, (2) platform/infra modules,
(3) domain modules, (4) web frontend, (5) database/data layer, (6) build/test/CI/tooling.

## Verdict

The codebase is disciplined and structurally sound: uniform module shape
(routes/service/schema/backup/test), near-zero direct SQL in route handlers, atomic multi-write
creates, fail-closed authorization with documented past-leak fixes, and a top-decile SQLite data
layer (explicit ON DELETE semantics + ADR, owner-documented polymorphic cleanup, compensation-staged
transactions). Debt is **concentrated, not diffuse**, in four clusters:

1. **Module-wiring registry proliferation — one registry has already drifted.**
2. A handful of route files / components that grew into services (800-line-rule breaches).
3. Cross-module boilerplate duplication (`okJson` ×31, hand-rolled pagination ×10, attachment
   route quartet ×4).
4. Quality-gate waste (the api suite executes up to 3× per push).

No P0/P1 security finding in this pass. One HIGH correctness drift (D1) and one HIGH test gap (D3).

---

## Findings

### D1 (HIGH, drifted) — Hand-duplicated route-mount registry omits `/admin/storage/*`

`apps/api/scripts/lib/route-table.ts:44-70` (`buildApiApp`) hand-duplicates the mounts of
`routes/protected.ts` + `routes/public.ts`. `protected.ts:78` mounts `storageRoutes()`, but
`buildApiApp()` never does. Confirmed impact: the 4 storage admin routes
(`file/storage.routes.ts:78,111,195,234`) appear in **neither** `docs/reference/api-routes.md`
**nor** the committed spec (`skills/bithk/references/api-spec.json`: 207 paths, 0 with "storage").
Third occurrence of this bug class (FIX-045 previously missed ship/search/worklist).
`check:api-docs`/`check:api-spec` cannot catch it — they diff generated-vs-committed and the
generator itself is blind. → REFACTOR-030.

### D2 (HIGH, friction) — 5 parallel path→module registries per new module

A new module must edit: `db/schema.ts`, `routes/protected.ts`, `shared/modules.ts:20` (or
`module-gate.ts:69` `UNGATED_PREFIXES`), `account/tokens/scope.ts:32` (`TOKEN_MODULES`), and
`scripts/lib/route-table.ts:44`. Three are near-identical prefix→key maps with duplicated
first-match-wins matchers (`moduleForPath` vs `tokenModuleForPath`). Two are test-enforced
(`module-gate.test.ts:213`, `scope.test.ts:78`) and have never drifted; the unenforced one is
exactly the one that drifted (D1). The onboarding playbook (`docs/develop/module/playbook.md`)
documents only 3 of the 5. → REFACTOR-030 (doc), REFACTOR-031 (manifest).

### D3 (HIGH) — `policy/middleware.ts` (global authz gate, 240 lines) has no direct tests, plus a silent fail-open branch

No test imports the route-permission enforcement layer. `policy/middleware.ts:203`
(`if (!access || !def) return next();`) passes an unauthorized request through when a matched
binding has no registered access instance — contradicts the fail-closed boot assert
(`app.ts:163-169`). Unreachable via `defineResource` today, but a wiring bug should 500, not
fail open. → FIX-054.

### D4 (HIGH, perf) — Contact list N+1 capability resolution

`contact/contact.service.ts:464-471` loops page rows calling `resolveContactCapabilities`
(policy-engine check) + `composeWithCapabilities` per row → ~2×N queries per list request.
Issue/overview lists batch correctly by contrast (`issue.service.ts:477-478`,
`overview.service.ts:330-413`). → FIX-055.

### D5 (HIGH, dup) — Attachment route quartet duplicated 4×, with auth drift

Upload / attach-from-drive / list / delete handlers are near-identical (~150-250 lines each) in
`issue.routes.ts:602`, `procurement.routes.ts:482`, `document.routes.ts:683`, `hr.routes.ts:325`.
Procurement's delete uses ad-hoc inline auth (`procurement.routes.ts:622-626`) instead of issue's
unified gate (`issue.routes.ts:704-739`). The codebase already demonstrates the fix:
`item/comment.routes.ts` `mountItemCommentRoutes` factory. → REFACTOR-032.

### D6 (MED, dup) — Shared-helper adoption lags the helpers

- `okJson`/`okListJson`/`errorJson` OpenAPI helpers copy-pasted in **31 route files** (verified by grep).
- `parseTagIds` ×4 (`contact`, `issue.routes.ts:163-175`, `procurement.routes.ts:158-170`,
  `project.routes.ts:87-99`).
- `shared/lib/pagination.ts` exists but only 3 modules use it; ~10 services hand-roll
  `(page-1)*limit` + `count()` with divergent max limits (100 vs 200), e.g. `policy.routes.ts:182`,
  `audit.routes.ts:34`, `cron.routes.ts:65`, `users.routes.ts:43`, `hr.service.ts:122`.
- Audit-call boilerplate (actor/ip/logger) repeated at 63 sites; an `auditFromCtx(c, entry)` helper
  removes ~350 lines and metadata drift. → REFACTOR-033.

### D7 (MED) — Route files that grew into services

`drive.routes.ts` 1229, `ship.routes.ts` 1109, `document.routes.ts` 998, `project.routes.ts` 946
exceed the repo's 800-line cap (size = route count + OpenAPI boilerplate; handlers stay small).
True layering breaches:
- `account/auth/auth.routes.ts` (899): in-file rate limiter + lockout state machine (lines 130-220,
  exports `__resetSingleUserLockoutForTests`), ~160-line OIDC callback orchestration (from line 351).
- `cron/cron.routes.ts`: direct drizzle in handlers (315, 368, 535, 583, 628) despite
  `cron.service.ts` existing; create-handler is a full inline workflow (~280-340).
- `account/users/users.routes.ts`: raw db at 197/248/602.
- Document cascade delete lives in the route handler with per-descendant N+1 and **no transaction**
  (`document.routes.ts:501-514`).
- `drive.service.ts:743-779` `purgeEntries`: deletes entries then loops share/ref cleanup un-wrapped
  (mid-failure orphans). → REFACTOR-034.

### D8 (MED) — `search` is the only inverted dependency (infra → domain)

`search/search.service.ts:1-9` imports 6 domain modules' service internals (drive, drive
team-directory, document, issue, project, ship). Every new searchable module requires editing
search. The registry pattern already used by `backup/registry.ts` and `tag/tag.registry.ts`
(`registerSearchSource`) fixes the direction. → REFACTOR-035.

### D9 (MED) — `shared/` layer boundary is honor-system

`shared/middleware/auth-registry.ts:9-11` claims shared stays free of account imports, yet
`api-token-scope.ts:3`, `csrf.ts:3`, `totp.ts:3` import account internals; `app-config.ts:4` →
settings; `upload-limits.ts:4` → file. No runtime cycle today. Either inject via registries or
retire the claim. → REFACTOR-031 (partial: scope map moves out of account), rest recorded as
accepted deviation.

### D10 (MED) — Web data-layer discipline leaks

- Inline literal query keys duplicated against factories: `projects/-project-issue-hooks.ts:57,71-72`
  hardcodes `["projects", projectId, "issues"]` AND calls `projectKeys.issues(...)` — missed-invalidation
  hazard; ad-hoc keys in `admin/-policies-shared.ts:54`, `-settings-about.tsx:95`.
- 36 direct `http()`/`httpRaw` calls inside route files bypass the api layer.
- `keepPreviousData` used exactly once (`shared/lib/api/ships.ts:180`); other paginated lists
  blank-flash on page/filter change.
- API view types are hand-mirrored in ~35 `shared/lib/api/*.ts` files while the server already
  generates an OpenAPI spec — drift caught only at runtime (type generation deferred, see Out).
  → UI-028.

### D11 (MED) — Web god-components block testing

`-project-issues-tab.tsx` 897 (list + create dialog + row widgets + direct http upload),
`admin/users/groups.lazy.tsx` 858 (24 `useState`), `-contact-panel.tsx` 717, `-colleague-panel.tsx`
691, breaching the 800-line cap ×3. Untested files correlate directly with the oversized ones.
Zero `React.memo` on list rows (latent perf cliff at 1k+ rows). ~20 files use dynamic
`t(\`ns.x.${v}\`)` template keys that permanently defeat `check-i18n` unused-key detection.
→ UI-029.

### D12 (MED) — Quality-gate waste and dev-loop hazards

- `check:routes` re-runs the slowest api tests already covered by `test` (root `package.json:36`).
- CI coverage gate re-runs the **entire api suite a second time** (third counting `check:routes`).
- api dev script has no `--watch` — the documented "stale backend vs fresh frontend" failure mode.
- `tests/` is not linted (`lint` covers `apps/ scripts/` only; the eslint override for
  `tests/e2e/**` at `eslint.config.ts:31-38` is dead config). Smoke suite runs nowhere.
- Milkdown teardown flake unmitigated (no vitest `retry` on the two mounting suites).
- No bun install cache in CI (1216-package lockfile installed 3×); macOS matrix leg doubles the
  heaviest job for a Linux-deployed app.
- Root `overrides` forces `hono ^4.12.25` while `apps/api` declares `4.12.23` — manifest pin is a lie.
- Dead one-off `tests/parity/capture-plan-019.ts`. → FIX-056.

### D13 (MED) — Data-layer refinements

- Missing FK indexes on users-CASCADE children of the largest tables: `files.uploaded_by`,
  `file_references.created_by` (`file/schema.ts:38,79`), `drive_entries.created_by`
  (`drive/schema.ts:33`).
- `relation_tuples.created_by` (`policy/schema.ts:15`) is the only FK without an explicit
  ON DELETE action (NO ACTION blocks user hard-delete).
- `drive_entries.created_at/updated_at` default to `CURRENT_TIMESTAMP` (space format) while every
  other table uses ISO-8601 `$defaultFn` (`drive/schema.ts:34-35`).
- `PRAGMA optimize`/`ANALYZE` never runs — the query planner has no stats.
- `generatePayrollForPeriod` per-row inserts outside a tx (idempotent but N fsyncs)
  (`hr/hr.payroll.service.ts:184-215`). → FIX-057.

### D14 (MED) — Test-coverage contract gap

`apps/api/bunfig.toml` excludes all `*.routes.ts` from coverage on the premise "e2e is the
system-of-record for HTTP behaviour", but 10 of 22 modules have **zero e2e** (contact, currency,
file, hr, item, overview, procurement, project, share, tag) and `document` has 0 route tests.
Priority: file, share, project, procurement, hr (auth-sensitive). → TEST-001.

### D15 (LOW) — Misc

- `packages/shared/` contains only `node_modules/`, untracked, yet `docs/architecture.md` documents
  it as a shared utilities package; the `packages/*` workspace glob picks it up.
- OpenAPI tags `"infra1"`/`"infra2"` leaked placeholders (`storage.routes.ts:82`,
  `settings.routes.ts:69`, `system.routes.ts:84`).
- `csrf.ts:49-53` / `service-token.ts:19-45` hand-roll the error envelope instead of `AppError`.
- Background workers form a hidden paired registry across `app.ts:140-153` (start) and
  `index.ts:81-84` (stop); `buildFullApp` mixes pure composition with side effects — the root cause
  that forced route-table to duplicate mounts (D1).
- Index naming mixed (`idx_<t>_<c>` vs `<t>_<c>_idx`) — unify at next migration collapse.
  → folded into REFACTOR-030/031/034 where touching the same files; otherwise recorded here.

## Strengths (keep)

- Fail-closed policy boot assert (`app.ts:163-169`); self-enforcing registry tests
  (`scope.test.ts:78`, `module-gate.test.ts:213`) — extend this pattern, don't replace it.
- Clean cross-module seams: file attachment SPI, tag service, **share adapter registry**
  (`share/adapter.ts:51-85`) — the model for D8.
- `mountItemCommentRoutes` factory (`item/comment.routes.ts`) — the model for D5.
- Data layer: pragma set, `runWrite` cast confinement, partial GC index
  (`file/schema.ts:46`), batch-throttled audit retention, drift-tested migrations.
- Web: universal route-level code splitting, lazy univer/milkdown/pdf, single `HttpError`
  envelope + global 401 bus, i18n loader with parity gate.
- Generated-artifact gates (`check:api-docs`/`api-spec`/`env-docs`/`i18n`) — limited only by D1.

## Remediation map

| Finding | Task | Wave |
|---|---|---|
| D1, D2(doc) | REFACTOR-030 | 1 |
| D2(manifest), D9(partial) | REFACTOR-031 | 2 |
| D3 | FIX-054 | 1 |
| D4 | FIX-055 | 1 |
| D5 | REFACTOR-032 | 2 |
| D6 | REFACTOR-033 | 3 (after route-file surgery) |
| D7 | REFACTOR-034 | 2 |
| D8 | REFACTOR-035 | 1 |
| D10 | UI-028 | 1 |
| D11 | UI-029 | 2 |
| D12 | FIX-056 | 1 |
| D13 | FIX-057 | 1 |
| D14 | TEST-001 | 3 |

Out of scope (needs decision, not auto-fixed): OpenAPI→TS type generation for web (design choice),
HR flat-RBAC ADR vs row-level payroll scoping (product decision), migration collapse (defer until
concurrent campaigns finish), macOS CI leg demotion (billing decision).
