# Audit Remediation Backlog

**Campaign:** `l1-w6c655lo-audit-20260602135842` · Source: the 7 dimension reports in this folder (see [./index.md](./index.md)).

This is a **backlog only**. No code, dependency, config, or schema change is authorized by this document. Items use descriptive `FIX-AUDIT-*` (correctness/security/behaviour) and `REFACTOR-AUDIT-*` (dead-code/dedup/cleanup) ids that are intentionally distinct from `docs/plan/index.md`'s `PLAN-*`/`FIX-*` series — do not renumber them into the plan series until a removal/fix campaign claims them.

**Ordering:** (1) high-severity correctness, then (2) dead-code high-confidence-first (safe early removal), then (3) mediums, then (4) low-value cleanups. Effort: **S** ≤ half-day · **M** ≈ 1–2 days · **L** ≥ multi-day. The 274 low findings are represented by **grouped** items (e.g. the 109 dead i18n keys are one row, not 109); per-finding detail lives in the dimension reports.

---

## 1 — High-severity correctness (do first)

| ID | Title | Source (dimension · file:line) | Sev | Conf | Effort | Action |
|----|-------|--------------------------------|-----|------|--------|--------|
| FIX-AUDIT-001 | SSRF via redirect-following in cron http-request | backend · `cron/actions/http-request/executor.ts:191-194,224` | high | high | S | Set `redirect:"manual"` (or `"error"`) and re-run `isPrivateDestination` on every `Location` host before following. |
| FIX-AUDIT-002 | Backup restore wipes tables omitted from payload | backend · `backup/restore.service.ts:334-342` | high | high | M | Only `delete` tables that have a corresponding rowset in the backup, or validate the payload is complete-by-module before deleting. |
| REFACTOR-AUDIT-001 | Unify the API response envelope type | architecture · `apps/web/src/shared/lib/api/projects.ts:17` (+13 siblings) | high | high | M | Define one discriminated `ApiEnvelope<T>`/`ApiListEnvelope<T>` in a single `web/lib/api/types.ts` and import everywhere; drop the 14 inline copies. |

## 2 — Dead code (high-confidence first = safe early removal)

| ID | Title | Source (dimension · file:line) | Sev | Conf | Effort | Action |
|----|-------|--------------------------------|-----|------|--------|--------|
| REFACTOR-AUDIT-002 | Delete orphaned `api-response.ts` + `pagination.ts` cluster | dead-code-api · `shared/lib/api-response.ts:1`, `shared/lib/pagination.ts:1` | medium | high | S | Delete both files (zero importers; dead cluster). |
| REFACTOR-AUDIT-003 | Remove orphaned web TOC cluster + dead persistence helpers | dead-code-web · `editor/toc.tsx`, `toc-scanner.ts`, `toc-scanner.test.ts`, `documents/document-tree.utils.ts:159-189` | medium | high | S | Delete the 3 TOC files + `readPersistedExpansion`/`writePersistedExpansion`/`STORAGE_KEY`. |
| REFACTOR-AUDIT-004 | Remove orphaned `packages/shared` workspace + `@noble` dep | dead-code-deps DEP-1 + architecture Area A · `apps/{api,web}/package.json`, `packages/shared/**` | medium | high | M | Delete the package, both `@app/shared` workspace deps, and `@noble/secp256k1` — or document it as template-only. (cross-ref dead-code-api `api-response.ts`.) |
| REFACTOR-AUDIT-005 | Remove 5 dead API exports | dead-code-api §1 · `request-id.ts:27`, `totp.ts:19`, `file/permission.ts:52`, `storage/registry.ts:56`, `item.service.ts:430` | low | high | S | Drop `withRequestIdHeader`, `requireTotpStepUp`, `listRegisteredOwnerTypes`, `listRegisteredDrivers`, `makeCommentValidationError`. |
| REFACTOR-AUDIT-006 | Strip 109 dead i18n keys (en **and** zh) | dead-code-web §D · `apps/web/src/locales/{en,zh}/*.json` | low | high | M | **Grouped item** (109 keys × 2 locales ≈ 218 strings across 9 namespaces). Remove from both locales; run `i18n-parity.test.ts` after. |
| REFACTOR-AUDIT-007 | Drop dead web re-export + dead test type | dead-code-web §B · `ships/-ship-colors.ts:9`, `test/utils.tsx:39` | low | high | S | Delete the pass-through `ISSUE_STATUS_BADGE` re-export and unused `RenderWithProvidersResult`. |
| REFACTOR-AUDIT-008 | Demote needless `export` modifiers to file-local | dead-code-api §3 (7 value + 3 barrel) + dead-code-web §C (13 value + 27 type) | low | high/med | M | **Grouped.** Drop `export` where the symbol is module-local; verify intended API-module type surface before touching `web` types. Lint-level, zero runtime. |
| REFACTOR-AUDIT-009 | Resolve 2 test-only API functions | dead-code-api §2 · `file.service.ts:411,573` (+ barrel `file/index.ts:20,25`) | low | med | S | Confirm intent for `listReferencesByOwner`/`totalStoredBytes`; if not public API, remove fn + its tests + barrel re-export. |
| REFACTOR-AUDIT-010 | Move `shadcn` CLI to devDependencies | dead-code-deps DEP-2 · `apps/web/package.json:51` | low | high | S | Move to `devDependencies` or invoke via `bunx shadcn@latest` (CLI, zero source imports). |
| REFACTOR-AUDIT-011 | Document undocumented env vars | dead-code-deps ENV-1/ENV-2 · `web/.../denied.tsx:35`, `api/src/root.ts:12` | low | high/med | S | Add `VITE_REQUEST_ACCESS_EMAIL` and a `ROOT_DIR` comment to `.env.example`; optionally extend `check:env-docs` to `VITE_*`. |

> `dead-code-deps` DEP-3 (`consola`/`otpauth` declared twice but used in both scopes) is **not** a removal candidate — accept as-is or hoist to a single root pin; noted for completeness, no backlog row.

## 3 — Medium correctness / security / quality

### 3a — Backend (PII, secrets, log leakage, atomicity, bounds)

| ID | Title | Source · file:line | Sev | Conf | Effort | Action |
|----|-------|--------------------|-----|------|--------|--------|
| FIX-AUDIT-003 | Contact list `q` probes masked PII | backend · `contact/contact.service.ts:188-190` | medium | high | M | For non-privileged actors restrict `q` to always-visible fields, or exclude rows whose fields would be masked. |
| FIX-AUDIT-004 | Supplier IDOR / existence leak in procurement | backend · `procurement/procurement.service.ts:51-60` | medium | high | M | Resolve supplier through the capability-aware contact accessor, or restrict suppliers to non-confidential contacts. |
| FIX-AUDIT-005 | Encrypt + redact cron job secrets at rest | backend · `cron/cron.routes.ts:175,204`, `cron/serialize.ts:57-64` | medium | high | M | Encrypt secret-typed fields (or store a secret ref) and redact them in `serializeJob`. |
| FIX-AUDIT-006 | Drop response/stderr bodies from cron logs | backend · `http-request/executor.ts:250-252`, `shell/executor.ts:100` | medium | high | S | Persist status + duration only; drop the reflected body/stderr (or gate behind a debug flag). |
| FIX-AUDIT-007 | `soft-delete-cleanup` NaN → purge-everything | backend · `cron/actions/soft-delete-cleanup/executor.ts:48` | medium | high | S | Reject non-finite `olderThanDays` (throw) instead of falling back to deleting all soft-deleted jobs. |
| FIX-AUDIT-008 | `export-via-token` full DB exfiltration | backend · `backup/export.routes.ts:37` | medium | high | M | Scope the token to modules and/or pair with network ACLs; redact secret-typed fields; document blast radius. |
| FIX-AUDIT-009 | `audit()` swallows insert errors (no trail) | backend · `audit/audit.service.ts:28` | medium | high | M | For high-sensitivity actions, propagate/alert on audit-write failure; keep best-effort only for routine events. |
| FIX-AUDIT-010 | `drive_entry` ACL hook denies team/project/share | backend · `drive/drive.file-permission.ts:5-34` | medium | high | M | Reuse `resolveEntryCapabilities` in the hook so team/project/share access is honored. |
| FIX-AUDIT-011 | Public share routes have no rate limiting | backend · `share/share.public.routes.ts` | medium | high | S | Apply `rateLimit({ bucket:"share-public" })` (IP-keyed) to the public share router. |
| FIX-AUDIT-012 | Non-atomic ship-cover reference release | backend · `ship/ship.service.ts:445-487,395-412` | medium | high | M | Move release into the transaction via `releaseReferenceTx`, finalize blob after commit (mirror project F4). |
| FIX-AUDIT-013 | XFF spoofing when proxy allow-list empty | backend · `shared/lib/client-ip.ts:42-45`, `config/sentinels.ts:64` | medium | high/med | M | In production, refuse forwarding headers when `TRUST_PROXY=true` with no allow-list; require `APP_URL`/`CORS_ORIGIN`. |
| FIX-AUDIT-014 | CSRF origin check skipped when no allowed-origins | backend · `shared/middleware/csrf.ts:56-66` | medium | med | S | Fail closed (reject mutating requests) in production when no allowed-origin list can be built. |
| FIX-AUDIT-015 | Suffix-based settings secret masking + unbounded value | backend · `settings/settings.service.ts:15`, `settings.routes.ts:24` | medium | high | M | Move secrets out of the generic settings table (env), enforce the suffix contract, add `.max(N)` to the value. |
| FIX-AUDIT-016 | Missing input bounds at handler edges | backend (cluster) · `ship.routes.ts:42`, `procurement.routes.ts:143-150`, `issue.routes.ts:142-146`, `users.routes.ts:95-124`, `cron.routes.ts:204` | medium | high | M | **Grouped.** Add zod bounds (`q.max`, enum status/priority, tag count/length, preference size/key) and use `parsePageQuery`. |
| FIX-AUDIT-017 | Non-atomic two-step writes | backend (cluster) · `policy.routes.ts:162-170`, `item/comment.service.ts:177-180`, `groups.routes.ts:167-201` | medium | high | M | **Grouped.** Wrap delete-then-create / release-then-delete / check-then-insert in a transaction. |
| FIX-AUDIT-018 | `composeIssue` non-null assertion → 500 | backend · `issue/issue.service.ts:160,305` | medium | high | S | Handle the missing `issue_details` row with a typed `NotFoundError`/`AppError`. |
| FIX-AUDIT-019 | Raw `Error` → 500 instead of 404 (document/drive) | backend · `document/document.service.ts:124,236,709`, `drive/drive.service.ts:736` | medium | high | S | Throw `NotFoundError`; match the specific constraint index in `throwDuplicateName`. |
| FIX-AUDIT-020 | Direct-share capability ignores expiry/exhaustion | backend · `drive/drive.permission.ts:100-116` | medium | med | S | Add `expiresAt`/exhaustion checks to the direct-share capability query. |

### 3b — Frontend

| ID | Title | Source · file:line | Sev | Conf | Effort | Action |
|----|-------|--------------------|-----|------|--------|--------|
| FIX-AUDIT-021 | No app-wide error boundary (white-screen) | frontend · `app/__root.tsx:12`, `app/providers.tsx:12` | medium | high | M | Add a root `errorComponent` + a React `ErrorBoundary`/`QueryCache.onError` catch-all. |
| FIX-AUDIT-022 | Query errors swallowed into empty-state | frontend D.2 (cluster) · `-project-overview-tab.tsx:40`, `-share-lists.tsx:249,268`, `-policies-tuples.tsx:38`, `-policies-resource-groups.tsx:24`, `documents/index.lazy.tsx:18` | medium | high | M | **Grouped.** Thread `isError`/`error` into list/card surfaces and render error/retry before the empty branch. |
| FIX-AUDIT-023 | Cache-invalidation vocab/count gaps | frontend C.1 · `api/ships.ts:233,265`, `api/contacts.ts:174,187`, `api/documents.ts:227` | medium | high | S | **Grouped.** Invalidate `shipKeys.tags()`/`count`, `contactTagKeys.vocabulary`, `documentsKeys.tags()` on the relevant mutations. |
| FIX-AUDIT-024 | Hardcoded CJK date + English `Supported formats` | frontend B · `-documents-shared.ts:16`, `admin/-cron-create-drawer.tsx:186` | medium | high | S | Format via `Intl`/`shared/lib/format.ts`; translate the `<summary>` label. |
| FIX-AUDIT-025 | Hand-rolled fetch where `useQuery` belongs | frontend C.2 · `settings-dialog.tsx:132` (TotpTab), `admin/-settings-shared.tsx:27` | medium | high | M | Replace `useState`+`useEffect`+manual refetch with `useQuery`/`useMutation` keyed in the settings layer. |
| REFACTOR-AUDIT-012 | De-duplicate issue/procurement panels + tag combobox | frontend E.1/E.2 · `-project-issue-panel.tsx`, `-project-procurement-panel.tsx`, `-project-tags-combobox.tsx`, `ships/-ship-tags-combobox.tsx` | medium | high | L | Extract shared `<DetailMetaRow>`, description-editor block, priority-variant map, and one `<TagsCombobox>`. |

### 3c — Architecture & testing

| ID | Title | Source · file:line | Sev | Conf | Effort | Action |
|----|-------|--------------------|-----|------|--------|--------|
| REFACTOR-AUDIT-013 | Eliminate route non-null `!` clusters | architecture C · `shared/lib/types.ts:17` (+ ~200 sites) | medium | high | L | Give protected routes a typed `Hono<ProtectedEnv>` sub-app with non-optional `Variables.user` + a typed param helper. |
| REFACTOR-AUDIT-014 | Single `runWrite()` helper for Drizzle `.changes` | architecture D · ~11 service files | medium | high | S | Add one typed `runWrite(stmt): RunResult` in the db layer; confine the `as unknown as` cast to one audited spot. |
| REFACTOR-AUDIT-015 | Decide & enforce module-barrel boundary | architecture E · all 19 `modules/*/index.ts` | medium | med | M | Either export the public surface + `eslint no-restricted-imports` to forbid deep imports, or drop the half-applied barrels. |
| FIX-AUDIT-026 | Bring HTTP layer under the local gate | testing A1 · `package.json:35`, `apps/api/bunfig.toml` | medium | high | M | Add an e2e/route-harness step to `bun run check`, or require `test:e2e` before merging any `*.routes.ts` change. |
| FIX-AUDIT-027 | Raise web coverage floor; test pure logic | testing A2/D1 · `apps/web/vitest.config.ts:60` + hooks/utils | medium | high | M | **Grouped.** Ratchet the floor incrementally; start with `tag-utils`/`status-colors`/`errors`/`use-debounce`. |
| FIX-AUDIT-028 | Integration tests for `/files` + drive ACL hook | testing B1/B2 · `file/file.routes.ts:25,63`, `drive/drive.file-permission.ts:6,20` | medium | high/med | M | Add e2e/unit for owner/non-owner/missing-id/`?inline` and the `canRead`/`canDelete` predicate. |

## 4 — Low-value cleanups (grouped; representative, not 1:1 with all 274 lows)

| ID | Title | Source (dimension) | Sev | Conf | Effort | Action |
|----|-------|--------------------|-----|------|--------|--------|
| REFACTOR-AUDIT-016 | Migrate 23 hand-rolled native `<button>` to shadcn `Button` | frontend A | low | high | L | Use `variant ghost/link` + `asChild`; centralize focus-visible styling. |
| REFACTOR-AUDIT-017 | Translate the a11y-string tail | frontend B (low) | low | high | M | `aria-label`/`sr-only`/`title` literals (dialog close, sidebar toggle, remove-tag, doc title, row actions). |
| REFACTOR-AUDIT-018 | One loading-UX convention + dedup row/card scaffolding | frontend D.4/E.3/E.4/E.5/E.6 | low | high/med | M | Skeletons for lists; extract `<ListRow>`/`<PinToggle>`/`<TagBadgeList>`/`PasswordPrompt`; route dates through `shared/lib/format`; move status colors into `status-colors.ts`. |
| FIX-AUDIT-029 | Add missing mutation `onError` feedback | frontend D.3 · ship/contact delete, share revoke, tuple-row delete | low | high | S | Add `onError` toasts so failed writes are not silent. |
| FIX-AUDIT-030 | De-flake real-clock tests | testing C · `comment.test.ts:176`, `pin.routes.test.ts:214`, `rate-limit.test.ts:37`, `logger.test.ts:23`, `retention.test.ts:127` | low | med | S | Order by deterministic key / inject a clock instead of `Bun.sleep`/`windowMs:1`. |
| FIX-AUDIT-031 | Backend low-severity hardening tail | backend (58 low cluster) | low | mixed | L | **Grouped.** Optimistic-version guards, LIKE `%`/`_` escaping, IPv6 proxy CIDR, timing/length side-channels, soft-delete `where` filters, audit `resourceId` consistency, etc. — see `backend.md`. |
| FIX-AUDIT-032 | Testing low tail | testing B3-B5/D2/D3/E1 | low | high | M | **Grouped.** Unit tests for PKCE seal/open, `parsePageQuery`, route-registry bindings, `pagination-footer`; embedded-migration compile smoke. |
| REFACTOR-AUDIT-019 | Architecture low config tweaks | architecture F · `apps/api/package.json:14`, root `tsconfig.json`, `policy/permission.ts:176` | low | high/med | S | Point `exports["."]` at a stable entry (or document `dev.ts`); optional `tsc -b` references; add field-filter unit tests. |

---

## Closing note

Removal and fixes are deferred to a **separately-approved** campaign — this is a backlog, not an authorization. When that campaign runs:

- Start with §1 (the 3 highs), then §2 dead code (high-confidence first is safest), then §3, then §4.
- Re-verify each finding still reproduces at the cited `file:line` before changing code (the reports are a 2026-06-02 snapshot).
- For `REFACTOR-AUDIT-006` (i18n) remove keys from **both** `en` and `zh` and run `i18n-parity.test.ts`.
- Honor the dev-phase posture: breaking changes are acceptable, no backward-compat/migration shims required (the DB may be reset freely).
- Tools that mutate the lockfile (`knip`) must be run ephemerally and reverted with `git checkout -- bun.lock package.json`.
