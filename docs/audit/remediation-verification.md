# Remediation Verification — Aggregate Matrix (51 rows)

**Campaign:** `l1-w6c655lo-verify-20260603031707` · **Aggregator:** L3 A1 (`bkd/nowydkqz`)
**Base:** main @ `146d991` (the remediated tree under verification; all 51 backlog items present)
**Mode:** VERIFICATION-ONLY — read-only on all source. The only file written is this aggregate.

This matrix consolidates the six per-lane verification reports under `docs/audit/verify/`
into a single 51-row table covering `FIX-AUDIT-001..032` (32) + `REFACTOR-AUDIT-001..019` (19).
Verdicts and evidence (`file:line`) are pulled verbatim from the lane reports; this aggregator
does **not** re-verify source — it sanity-checks the row count (= 51), uniqueness (each ID once),
and verdict tally against the lane reports.

| Lane report | Scope |
|-------------|-------|
| `verify/01-highs.md` (V1) | FIX-AUDIT-001, -002 + REFACTOR-AUDIT-001 |
| `verify/02-backend.md` (V2) | FIX-AUDIT-003,-004,-006..014,-016..020,-015 |
| `verify/03-frontend.md` (V3) | FIX-AUDIT-021..025 + REFACTOR-AUDIT-012 |
| `verify/04-deadcode.md` (V4) | REFACTOR-AUDIT-002..011 |
| `verify/05-architecture.md` (V5) | REFACTOR-AUDIT-013,-014,-015 + FIX-AUDIT-026 |
| `verify/06-testing-secrets.md` (V6) | FIX-AUDIT-005,-027..032 + REFACTOR-AUDIT-016,-017,-018,-019 |

---

## FIX-AUDIT (32)

| ID | Title | Verdict | Evidence (file:line) | Source report | Note |
|----|-------|---------|----------------------|---------------|------|
| FIX-AUDIT-001 | SSRF via redirect-following in cron http-request | VERIFIED-FIXED | `cron/actions/http-request/executor.ts:236` (`redirect:"manual"`), `:230-279` (per-hop re-vet), `resolveTarget` `:141-194` | 01-highs | DNS-pinned, exceeds cited Action; `HTTP_ACTION_ALLOW_PRIVATE` is a documented opt-out, not a bypass |
| FIX-AUDIT-002 | Backup restore wipes tables omitted from payload | VERIFIED-FIXED | `backup/restore.service.ts:340-344` (`Object.hasOwn` guard on `data.tables`) | 01-highs | Absent table key now skipped; present-but-empty array is a deliberate "replace with empty" |
| FIX-AUDIT-003 | Contact list `q` probes masked PII | VERIFIED-FIXED | `contact/contact.service.ts:191-216` (confidential fields matched only on visible rows) | 02-backend | Mirrors `canSeeConfidentialFields`; closes char-by-char search oracle |
| FIX-AUDIT-004 | Supplier IDOR / existence leak in procurement | VERIFIED-FIXED | `procurement/procurement.service.ts:62-73` (`assertSupplierExists`), call sites `:185-186`,`:291-292` | 02-backend | Option B taken; confidential id yields same "Unknown supplier" error as non-existent |
| FIX-AUDIT-005 | Cron job secrets at rest | N/A-BY-DECISION | `cron/serialize.ts:126-129` (decision comment) + `:49-62` (`redactSecrets`); `cron.routes.ts:27-42` (bounds); commit `160beb7` | 06-testing-secrets | No at-rest encryption by decision; redaction + value bounds present. Decision in code comment + commit, **not** a `docs/decisions/` entry |
| FIX-AUDIT-006 | Drop response/stderr bodies from cron logs | VERIFIED-FIXED | `cron/actions/http-request/executor.ts:284-302`; `cron/actions/shell/executor.ts:95-103` | 02-backend | Persisted error is status+duration only; stderr → process logger; shell stdout-on-success is intended output |
| FIX-AUDIT-007 | `soft-delete-cleanup` NaN → purge-everything | VERIFIED-FIXED | `cron/actions/soft-delete-cleanup/executor.ts:25-31` (`!Number.isFinite` / `<0` throws) | 02-backend | Documented `default 0 = purge immediately` preserved deliberately |
| FIX-AUDIT-008 | `export-via-token` full DB exfiltration | VERIFIED-FIXED | `backup/export.routes.ts:104-250` (mandatory scope fail-closed `:112-138`; redaction `:39-83,226`) | 02-backend | Per-token-scope binding flagged out-of-lane REMAINING in-code |
| FIX-AUDIT-009 | `audit()` swallows insert errors | VERIFIED-FIXED | `audit/audit.service.ts:29-84` (`critical` re-throws `:77-79`); callers `export.routes.ts:209,297`, `restore.routes.ts:183,203` | 02-backend | Destructive/exfiltrating actions opt into critical; rejection audits stay best-effort (correct) |
| FIX-AUDIT-010 | `drive_entry` ACL hook denies team/project/share | VERIFIED-FIXED | `drive/drive.file-permission.ts:30-44`; resolver `drive/drive.permission.ts:61-128` | 02-backend | `canRead`/`canDelete` delegate to `resolveEntryCapabilities` (owner/team/project/share) |
| FIX-AUDIT-011 | Public share routes have no rate limiting | VERIFIED-FIXED | `share/share.public.routes.ts:47` (`rateLimit` 120/60s); `shared/middleware/rate-limit.ts:3,100` (IP-keyed) | 02-backend | Applied across every public share path before handlers |
| FIX-AUDIT-012 | Non-atomic ship-cover reference release | VERIFIED-FIXED | `ship/ship.service.ts:404-414`,`:456-469`,`:490-497` (release in tx + post-commit finalize) | 02-backend | Mirrors project F4 pattern; rollback releases freshly-uploaded ref |
| FIX-AUDIT-013 | XFF spoofing when proxy allow-list empty | VERIFIED-FIXED | `shared/lib/client-ip.ts:49-51` (prod fail-closed); `config/sentinels.ts:51-85`; wiring `config.ts:60,63` | 02-backend | Empty allow-list in prod ignores forwarding headers, returns socket peer |
| FIX-AUDIT-014 | CSRF origin check skipped when no allowed-origins | VERIFIED-FIXED | `shared/middleware/csrf.ts:65-77` (prod 403 fail-closed); registered `app.ts:99` | 02-backend | Dev warns + proceeds; missing Origin/Referer rejected when list exists |
| FIX-AUDIT-015 | Suffix-based settings secret masking + unbounded value | PARTIAL | `settings/settings.routes.ts:27,30` (max-len); `settings.service.ts:36-64` (suffix masking); deferral `:17-20` | 02-backend | Value max-len + consistent suffix-masking landed; "move secrets to env" deferred (no decision doc). Suffix heuristic bypassable for arbitrarily-named secret keys |
| FIX-AUDIT-016 | Missing input bounds at handler edges (cluster) | VERIFIED-FIXED | `ship.routes.ts:80-84`; `procurement.routes.ts:71-76`; `issue.routes.ts:69-73`; `users.routes.ts:99-120`; `cron.routes.ts:63-65,31-49` | 02-backend | All five cited edges bounded; `parsePageQuery`/bounded cursor pagination |
| FIX-AUDIT-017 | Non-atomic two-step writes (cluster) | VERIFIED-FIXED | `policy/policy.service.ts:159-163` & `:486-515`; `item/comment.service.ts:184-188` | 02-backend | Delete-then-create / release-then-delete / check-then-insert each in one tx |
| FIX-AUDIT-018 | `composeIssue` non-null assertion → 500 | VERIFIED-FIXED | `issue/issue.service.ts:160-162` (guard replaces `!`), update path `:306-308` | 02-backend | Throws `NotFoundError` instead of 500; list/search use `innerJoin` |
| FIX-AUDIT-019 | Raw `Error` → 500 instead of 404 (document/drive) | VERIFIED-FIXED | `document/document.service.ts:126,238,711` (NotFoundError); `drive/drive.service.ts:744-752` (`throwDuplicateName`) | 02-backend | Duplicate-name match is index-specific; other UNIQUE violations rethrow |
| FIX-AUDIT-020 | Direct-share capability ignores expiry/exhaustion | VERIFIED-FIXED | `drive/drive.permission.ts:100-136` (`isShareExpired`/`isShareExhausted` gate at `:120`) | 02-backend | Expired/exhausted direct share no longer grants authenticated-route access |
| FIX-AUDIT-021 | No app-wide error boundary (white-screen) | VERIFIED-FIXED | `app/routes/__root.tsx:15` (`errorComponent`); `app/providers.tsx:29-44` (React boundary), `:81-95` (query-cache toaster) | 03-frontend | Three layers: router boundary + React boundary + query-cache `onError`; both fallbacks reload |
| FIX-AUDIT-022 | Query errors swallowed into empty-state (cluster) | VERIFIED-FIXED | `-project-overview-tab.tsx:278-281`; `-share-lists.tsx:233-235`; `admin/-policies-tuples.tsx:104-120`; `documents/index.lazy.tsx:31-40` | 03-frontend | All 6 cited surfaces + 2 low siblings: error branch ordered ahead of empty; retry wired |
| FIX-AUDIT-023 | Cache-invalidation vocab/count gaps | VERIFIED-FIXED | `api/ships.ts:232-235,269-273,317-319`; `api/contacts.ts:172-191`; `api/documents.ts:232,234` | 03-frontend | Create/update/delete invalidate lists+tags+counts; cover mutations correctly skip counts |
| FIX-AUDIT-024 | Hardcoded CJK date + English Supported-formats label | VERIFIED-FIXED | `app/routes/_app/-documents-shared.ts:15-24` (Intl locale-aware); `admin/-cron-create-drawer.tsx:186` (i18n key) | 03-frontend | Hardcoded `${m}月${d}日` gone; `cron.form.supportedFormats` in both locales |
| FIX-AUDIT-025 | Hand-rolled fetch where useQuery belongs | VERIFIED-FIXED | `shared/components/settings-dialog.tsx:136-179` (TotpTab useQuery/useMutation); `admin/-settings-shared.tsx:30-69` (`useSettingsByPrefix`) | 03-frontend | No residual `useEffect`/manual-refetch; caches share `settingKeys.all` namespace |
| FIX-AUDIT-026 | Bring HTTP layer under the local gate | VERIFIED-FIXED | `package.json:35` (`check` includes `check:routes`), `:36` (filter); 26 `*.routes.test.ts`; `shared/test/route-harness.ts` | 05-architecture | Route harness now runs inside `bun run check`; non-bypassable strengthening |
| FIX-AUDIT-027 | Raise web coverage floor; test pure logic | VERIFIED-FIXED | `apps/web/vitest.config.ts` (lines/stmts/fns 38, branches 33); `tag-utils.test.ts`, `status-colors.test.ts`, `errors.test.ts`, `use-debounce.test.ts` | 06-testing-secrets | Real ratchet (floor < measured ~42); all four prioritized pure-logic tests present |
| FIX-AUDIT-028 | Integration tests for `/files` + drive ACL hook | VERIFIED-FIXED | `file/file.routes.test.ts:72-148`; `drive/drive.file-permission.test.ts:98-149` | 06-testing-secrets | Covers 401/owner/non-owner-404/missing-ref-404 + ACL owner/stranger/admin/team-editor |
| FIX-AUDIT-029 | Missing mutation `onError` feedback | VERIFIED-FIXED | `ships/$shipId.lazy.tsx:92`; `contacts/index.lazy.tsx:356`; `-share-lists.tsx:207`; `admin/-policies-tuples.tsx:48` | 06-testing-secrets | All four cited mutations carry an `onError` toast |
| FIX-AUDIT-030 | De-flake real-clock tests | VERIFIED-FIXED | `item/comment.test.ts:179-180`; `item/pin.routes.test.ts`; `rate-limit.test.ts:36-53` (fake clock) | 06-testing-secrets | All five `Bun.sleep`/real-clock patterns removed; residual `windowMs:1` is GC-sweep (non-timing) |
| FIX-AUDIT-031 | Backend low-severity hardening tail (grouped, ~58 lows) | PARTIAL | `escapeLike` in 8 services; `client-ip.ts:103-141`; `project.service.ts:429-465`; residuals `service-token.ts:35`, `procurement.service.ts:307,382` | 06-testing-secrets | ~5/7 representative lows fixed; residuals = service-token length short-circuit + procurement optimistic-version guard, both rated negligible/optional by the audit |
| FIX-AUDIT-032 | Testing low tail (grouped) | VERIFIED-FIXED | `account/auth/pkce-secret.test.ts`; `shared/lib/pagination.test.ts`; `policy/route-registry.test.ts`; `pagination-footer.test.tsx`; `db/embedded-migrations.test.ts` | 06-testing-secrets | All five named sub-items present and substantive |

## REFACTOR-AUDIT (19)

| ID | Title | Verdict | Evidence (file:line) | Source report | Note |
|----|-------|---------|----------------------|---------------|------|
| REFACTOR-AUDIT-001 | Unify the API response envelope type | VERIFIED-FIXED | `apps/web/src/shared/lib/api/types.ts:7-17` (single `ApiEnvelope`/`ApiListEnvelope`); 14 siblings import `./types` | 01-highs | Shipped envelope is non-discriminated (`success:boolean`) — defensible since web `http` throws on error. One inline copy survives at `-project-issue-hooks.ts:18`, outside cited 14-file scope |
| REFACTOR-AUDIT-002 | Delete orphaned `api-response.ts` + `pagination.ts` cluster | PARTIAL | `api-response.ts` DELETED (0 refs); `pagination.ts` retained — `parsePageQuery` wired into `issue.routes.ts:20,161`, `procurement.routes.ts:10,164`, `ship.routes.ts:7,157` | 04-deadcode | `pagination.ts` no longer dead (promoted to live infra by FIX-AUDIT-016); benign/justified divergence from literal "delete both", no decision doc |
| REFACTOR-AUDIT-003 | Remove orphaned web TOC cluster + dead persistence helpers | VERIFIED-FIXED | `editor/toc.tsx`,`editor/toc-scanner.ts(.test.ts)` deleted (0 refs); `document-tree.utils.ts` (`readPersistedExpansion`/`STORAGE_KEY` removed) | 04-deadcode | All five symbols gone tree-wide; live file retained, dead block excised |
| REFACTOR-AUDIT-004 | Remove orphaned `packages/shared` workspace + `@noble` dep | VERIFIED-FIXED | `packages/shared/` DELETED; `@app/shared` & `@noble/secp256k1` = 0 hits in all `package.json` | 04-deadcode | Remaining `@noble/*` in `bun.lock` are transitive deps of `eciesjs`/`otpauth` (legit) |
| REFACTOR-AUDIT-005 | Remove 5 dead API exports | VERIFIED-FIXED | `request-id.ts:27`, `totp.ts:19`, `file/permission.ts:52`, `storage/registry.ts:56`, `item.service.ts:430` — all removed (0 refs) | 04-deadcode | Live siblings (`propagateRequestId`, `requireTotp`) intact |
| REFACTOR-AUDIT-006 | Strip 109 dead i18n keys (en AND zh) | VERIFIED-FIXED | `locales/{en,zh}/*.json` — dead keys removed across 9 namespaces; en↔zh parity holds (1321 distinct keys) | 04-deadcode | Adversarial false-alarm check: surviving leaf names resolved to live keys in other namespaces with real `t()` callers |
| REFACTOR-AUDIT-007 | Drop dead web re-export + dead test type | VERIFIED-FIXED | `ships/-ship-colors.ts` (`ISSUE_STATUS_BADGE` re-export removed); `test/utils.tsx:39` (`RenderWithProvidersResult` removed) | 04-deadcode | Canonical `ISSUE_STATUS_BADGE` in `status-colors.ts:27`, imported directly by consumers |
| REFACTOR-AUDIT-008 | Demote needless `export` modifiers to file-local | PARTIAL | API §3 7/7 + Web §C1/§C2 majority demoted; residuals `-project-tabs.ts:7` (`PROJECT_TABS`), `file/index.ts:12` (`DrainedBlob`), `-file-preview-types.ts:9` (`PreviewKind`), `api/documents.ts:70` (`Attachment`) | 04-deadcode | ~45/50 cited symbols addressed; 4 still needlessly exported with zero external importer. Low-severity, lint-level, discretionary |
| REFACTOR-AUDIT-009 | Resolve 2 test-only API functions | VERIFIED-FIXED | `file.service.ts:411` (`listReferencesByOwner`), `:573` (`totalStoredBytes`) — functions + tests + barrel re-exports removed | 04-deadcode | Resolved by removal (not-public-API intent honored); barrel lists only live symbols |
| REFACTOR-AUDIT-010 | Move `shadcn` CLI to devDependencies | VERIFIED-FIXED | `apps/web/package.json` — `shadcn 4.7.0` in `devDependencies`, absent from `dependencies` | 04-deadcode | — |
| REFACTOR-AUDIT-011 | Document undocumented env vars | VERIFIED-FIXED | `.env.example:273` (`VITE_REQUEST_ACCESS_EMAIL`), `:18,24,45` (`ROOT_DIR`) | 04-deadcode | Both documented with doc blocks; source still references both |
| REFACTOR-AUDIT-012 | De-duplicate issue/procurement panels + tag combobox | VERIFIED-FIXED | `shared/components/tags-combobox.tsx`, `detail-meta-row.tsx`, `detail-description.tsx`, `priority-variant.ts:9` — all extracted & consumed by both panels | 03-frontend | All four extractions delivered. Stale "1:1 port" header comments remain (doc-only, not a regression) |
| REFACTOR-AUDIT-013 | Eliminate route non-null `!` clusters | PARTIAL | `shared/lib/types.ts:30-33` (`ProtectedEnv`), `route-params.ts:18` (`requireParam`); 20 routers migrated; residuals `share/share.routes.ts:75` (6 `c.get("user")!`) + 18 `policyContext(c)!` | 05-architecture | Mechanism genuine, ~87% removed (~200→~25). Cited fully-protected `share.routes.ts` not migrated; `policyContext()` still returns `\| null` (no `requirePolicyContext` helper). L1/L2 may accept residual as within "bulk" intent |
| REFACTOR-AUDIT-014 | Single `runWrite()` helper for Drizzle `.changes` | VERIFIED-FIXED | `db/index.ts:99-114` (`runWrite` + `RunResult`); used across ~11 service files | 05-architecture | Unsafe `as unknown as RunResult` confined to single audited spot; 0 residual double-casts |
| REFACTOR-AUDIT-015 | Decide & enforce module-barrel boundary | N/A-BY-DECISION | `docs/decisions/009-module-barrels.md` (accepted 2026-06-03); 19 barrels intact, 15 call `registerBackupContribution` | 05-architecture | Document-keep decision honored: barrels are module-registration surface (import-time side effects), no `no-restricted-imports` rule added (deliberate) |
| REFACTOR-AUDIT-016 | Migrate 23 hand-rolled native `<button>` to shadcn `Button` | VERIFIED-FIXED | Native `<button>` only in `ui/sidebar.tsx` (sanctioned) + a test; `detail-meta-row.tsx:12`, `detail-description.tsx:9`, `detail-panel-header.tsx:13` use shadcn `Button` | 06-testing-secrets | ~0 native `<button>` remain in production component code (was 23 hand-rolled) |
| REFACTOR-AUDIT-017 | Translate the a11y-string tail | VERIFIED-FIXED | `-documents-tags.tsx:93`; `ui/sidebar.tsx:276,289`; `ui/dialog.tsx:78`; `-documents-create.tsx:68`; `admin/-cron-row-actions.tsx:43` | 06-testing-secrets | All spot-checked `aria-label`/`sr-only` literals route through i18n |
| REFACTOR-AUDIT-018 | One loading-UX convention + dedup row/card scaffolding | PARTIAL | `list-skeleton.tsx`, `pin-toggle.tsx`, `tag-badge-list.tsx`, `share/previews/shell.tsx`, `status-colors.ts:18-24` extracted; shared `ListRow`/`ListTable` NOT extracted | 06-testing-secrets | 5/6 named extractions done (incl. headline loading-UX convention); generic list-row shell (E.4) still hand-rolled in 3 lists |
| REFACTOR-AUDIT-019 | Architecture low config tweaks | VERIFIED-FIXED | `apps/api/package.json:13-14` (`exports["."]` → `app.ts`, commit `f12aa8f`); `policy/permission.test.ts:92,156-196` (filter tests) | 06-testing-secrets | `tsc -b` project references marked optional by the Action, acceptably absent |

---

## Summary — verdict counts

| Verdict | Count |
|---------|-------|
| VERIFIED-FIXED | 43 |
| PARTIAL | 6 |
| NOT-FIXED | 0 |
| REGRESSED | 0 |
| N/A-BY-DECISION | 2 |
| **Grand total** | **51** |

Self-check: 51 unique IDs (FIX-AUDIT-001..032 = 32, REFACTOR-AUDIT-001..019 = 19), each appearing
exactly once. Tally matches the merged lane reports (43 + 6 + 0 + 0 + 2 = 51).

---

## Non-VERIFIED items (8) — for L1 / user action

Every PARTIAL / N/A-BY-DECISION item with a one-line reason. (No NOT-FIXED or REGRESSED items.)

### PARTIAL (6)

| ID | One-line reason |
|----|-----------------|
| FIX-AUDIT-015 | Value max-length + suffix-masking landed, but "move secrets out of generic settings table to env" deferred (no decision doc); suffix heuristic still bypassable for arbitrarily-named secret keys (e.g. `oauth.clientSecretValue`). |
| FIX-AUDIT-031 | Bulk lows hardened (~5/7 sampled); residuals = service-token length short-circuit (`service-token.ts:35`) + procurement optimistic-version guard (`procurement.service.ts:307,382`) — both rated negligible/optional by the original audit. |
| REFACTOR-AUDIT-002 | `api-response.ts` deleted; `pagination.ts` retained because `parsePageQuery` is now live (wired by FIX-AUDIT-016) — benign divergence from literal "delete both", not a defect. |
| REFACTOR-AUDIT-008 | ~45/50 needless exports demoted; 4 remain needlessly `export`ed with no external importer: `PROJECT_TABS`, `DrainedBlob`, `PreviewKind`, `Attachment`. Low-severity, lint-level. |
| REFACTOR-AUDIT-013 | ProtectedEnv + `requireParam` genuine, ~87% of `!` removed; but `share/share.routes.ts` (fully-protected) not migrated (6 `c.get("user")!`) and 18 `policyContext(c)!` persist (no `requirePolicyContext` helper). May be accepted as within "bulk" intent. |
| REFACTOR-AUDIT-018 | 5/6 extractions done (incl. loading-UX convention); shared `ListRow`/`ListTable` shell (E.4) not extracted — bordered-row scaffolding still hand-rolled in 3 lists. |

### N/A-BY-DECISION (2)

| ID | One-line reason |
|----|-----------------|
| FIX-AUDIT-005 | No at-rest encryption for cron secrets is a deliberate decision; mitigation (response redaction + payload/size bounds) is in place. Decision recorded in `serialize.ts:126-129` + commit `160beb7`, **not** as a `docs/decisions/` entry. |
| REFACTOR-AUDIT-015 | Module barrels deliberately kept as the route-wiring/registration surface (15 of 19 call `registerBackupContribution`); decision recorded in `docs/decisions/009-module-barrels.md`, no import-lockdown lint rule added by design. |
