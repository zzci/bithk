# V4 Verification — Dead-Code remediation (REFACTOR-AUDIT-002 … 011)

**Campaign:** `l1-w6c655lo-verify-20260603031707` · **Verifier:** L3 V4 (`bkd/d94okckw`)
**Base:** main @146d991 (worktree HEAD 160beb7, 146d991 is ancestor — all 51 remediation commits present)
**Mode:** VERIFICATION-ONLY (read-only on all source; only this report was written)
**Source of truth:** `docs/audit/remediation-backlog.md` §2 + `dead-code-api.md`, `dead-code-web.md`, `dead-code-deps.md`

Method for every item: open the cited file on the current tree, confirm the Action was applied **and** that the symbol/file/key is gone tree-wide with **no dangling reference/import** (ripgrep across `apps/`, `packages/`, `bun.lock`, `package.json`). Adversarial: live "survivors" that merely share a leaf-name were checked by full key-path and source-usage.

---

## REFACTOR-AUDIT-002 — Delete orphaned `api-response.ts` + `pagination.ts` cluster
**Verdict: PARTIAL** (one of two files deleted; the other is no longer dead and was deliberately retained)

- `apps/api/src/shared/lib/api-response.ts` — **DELETED** ✓. `ls` → no such file. `rg "api-response"` tree-wide = **0** hits (no dangling import).
- `apps/api/src/shared/lib/pagination.ts` — **STILL PRESENT**, but it is **no longer dead code**. `parsePageQuery` is now imported and called by three live route modules:
  - `apps/api/src/modules/issue/issue.routes.ts:20,161`
  - `apps/api/src/modules/procurement/procurement.routes.ts:10,164`
  - `apps/api/src/modules/ship/ship.routes.ts:7,157`
  - plus its own test `apps/api/src/shared/lib/pagination.test.ts`.
- **Why the divergence:** the audit (`dead-code-api.md:32-34`) flagged `pagination.ts` as dead *because its only consumer was the dead `api-response.ts`*. The remediation campaign wired `parsePageQuery` into the route handlers as part of **FIX-AUDIT-016** ("Missing input bounds … use `parsePageQuery`"). So the "dead cluster" no longer exists: the genuinely-orphaned half (`api-response.ts`) was removed, and `pagination.ts` was promoted to live infrastructure. Deleting it now would be a regression.
- **What is "missing" vs the literal Action ("delete both files"):** `pagination.ts` was not deleted. This is a benign/justified divergence (root cause — orphaned cluster — is resolved), but flagged per the adversarial mandate; no decision doc records it.
- Method: `ls`, tree-wide `rg` for `api-response`, `parsePageQuery`, importer cross-check.

## REFACTOR-AUDIT-003 — Remove orphaned web TOC cluster + dead persistence helpers
**Verdict: VERIFIED-FIXED**

- TOC cluster **gone**: `find apps/web/src -iname "toc*"` → no results. `editor/toc.tsx`, `editor/toc-scanner.ts`, `editor/toc-scanner.test.ts` all deleted.
- No dangling refs: `rg "toc-scanner|TocScanner|TableOfContents|useHeadingAnchors|scanMarkdownHeadings"` in `apps/web/src` = 0. (The only `STORAGE_KEY` hits remaining are in `shared/components/theme-provider.tsx` — an unrelated theme key, not the document-tree one.)
- `apps/web/src/shared/components/documents/document-tree.utils.ts` retained (correct — file is live) but `readPersistedExpansion` / `writePersistedExpansion` / `STORAGE_KEY` **removed** (`rg` = 0 in that file; file now 152 lines, the cited 159-189 block gone).
- Method: `find`, tree-wide `rg` of all five symbols.

## REFACTOR-AUDIT-004 — Remove orphaned `packages/shared` workspace + `@noble` dep
**Verdict: VERIFIED-FIXED**

- `packages/shared/` — **DELETED** ✓ (`ls` → no such dir; `packages/` now contains only `tsconfig/`, the legit `@app/tsconfig` package still referenced).
- `@app/shared` workspace dep — **gone**: `rg "@app/shared"` across `apps/`, `packages/`, all `package.json` = **0**. Neither `apps/api/package.json` nor `apps/web/package.json` references `shared` or `noble`.
- `@noble/secp256k1` — **gone**: `rg "@noble/secp256k1"` across all JSON = **0**. The remaining `@noble/*` entries in `bun.lock` (`@noble/ciphers`, `@noble/curves`, `@noble/hashes`) are **transitive** deps of `eciesjs` / `otpauth` (legit, unrelated to the removed direct dep).
- Method: `ls`, tree-wide `rg` of `@app/shared` / `@noble/secp256k1`, package.json inspection.

## REFACTOR-AUDIT-005 — Remove 5 dead API exports
**Verdict: VERIFIED-FIXED**

All five symbols are gone tree-wide (`rg` across `apps/api/src` = 0 each — definition included, not merely the `export` keyword):
- `withRequestIdHeader` (was `request-id.ts:27`) — gone; the live sibling middleware `propagateRequestId` (`request-id.ts:11`) is intact, file compiles.
- `requireTotpStepUp` (was `totp.ts:19`) — gone; the original `requireTotp` (`totp.ts:5`) retained.
- `listRegisteredOwnerTypes` (was `file/permission.ts:52`) — gone.
- `listRegisteredDrivers` (was `storage/registry.ts:56`) — gone.
- `makeCommentValidationError` (was `item.service.ts:430`) — gone.
- Method: per-symbol tree-wide `rg`; live-sibling spot check.

## REFACTOR-AUDIT-006 — Strip 109 dead i18n keys (en AND zh)
**Verdict: VERIFIED-FIXED**

- **en↔zh parity holds.** Replicated `i18n-parity.test.ts` read-only (Python flatten + set-compare across all 20 namespaces): namespace parity OK, per-namespace key-set parity **ALL OK**, `en` leaf count == `zh` leaf count (1518 raw `"key":` lines; 1321 distinct full-path keys). (`bunx vitest` could not run — this fresh worktree has no `node_modules`; I did **not** run `bun install` to avoid touching `bun.lock`.)
- **Dead keys removed in both locales** (spot-checked across all 9 affected namespaces — audit/contacts/cron/documents/drive/issues/policies/projects/ships):
  - `audit:allActions/allResults`, `contacts:list.statusAll/categoryAll/tagFilter*/kpi.*`, `cron:typeFilter.all` (only live `typeFilter.cat.*` remains), `documents:col.title` & `conflict.title` (live `conflict.body` kept), `drive:teamDirectories/selectAll/clearSelection/browser.action.copyLink/...`, `issues:col.{title,priority,assignee,dueDate}` & top `allStatuses/allPriorities`, `policies:allNamespaces`, `projects:` toast/list.kpi/edit/detail.breadcrumb/viewMode/viewKanban/pipeline/members/`capabilityGroup.{project,members,roles,categories}`, `ships:list.kpi.*/detail.metricHints.*/equipment.uncategorized` — all return **0** full-path hits.
- **Adversarial false-alarm check:** leaf names that still appear (`allStatuses`, `allPriorities`, `viewGrid`, `createDescription`, `copyLink`, `uncategorized`, `conflict`) were each resolved to **live keys in a different namespace** with a real `t()` caller — e.g. `projects:procurement.allStatuses` (`-project-procurement-tab.tsx:158`), `drive:browser.viewGrid` (`-drive-file-list-toolbar.tsx:47`), `share:action.copyLink` (`share-dialog.tsx:496`), `ships:overview.uncategorized` (`-ship-overview-tab.tsx:83`). The dead twins (`issues:allStatuses`, `projects:list.viewGrid`, `drive:browser.action.copyLink`, `ships:equipment.uncategorized`) are all removed.
- `capabilityGroup` now = `{procurement, issue, files}` (the 4 dead leaves removed, 3 live kept) — confirms surgical, not wholesale, pruning.
- Method: distinctive-leaf `rg`, `python3 json` full-path resolution + source-usage cross-check, parity recomputation.

## REFACTOR-AUDIT-007 — Drop dead web re-export + dead test type
**Verdict: VERIFIED-FIXED**

- `ISSUE_STATUS_BADGE` pass-through re-export — **removed** from `apps/web/src/app/routes/_app/ships/-ship-colors.ts`; that file now only exports `SHIP_STATUS_BADGE` / `EQUIPMENT_STATUS_BADGE` (from `RECORD_STATUS_BADGE`). The canonical `ISSUE_STATUS_BADGE` lives in `shared/lib/status-colors.ts:27` and every consumer imports it directly (`-project-overview-tab.tsx`, `-project-issue-panel.tsx`) — no dangling import of it from `-ship-colors`.
- `RenderWithProvidersResult` (was `test/utils.tsx:39`) — gone: `rg` tree-wide = **0**.
- Method: file read + tree-wide `rg`.

## REFACTOR-AUDIT-008 — Demote needless `export` modifiers to file-local
**Verdict: PARTIAL** (bulk demoted; a few cited symbols retain a needless `export` with no external consumer)

Demoted correctly (now file-local, symbol intact):
- **API §3 value (7/7):** `composeShip`, `composeWorklist`, `updateSessionTokens`, `isSessionExpired`, `rateLimitKey`, `resolveGlobalCategory`, `listOrphanReferences` — all now plain `function`/`const`, no `export`.
- **Web §C1 value:** `extensionOf`, `priorityKey`, `toRouterPath`, `commentsQueryKey`, `defaultCoverKeys`, `contactCategoryKeys`, `globalCategoryKeys`, `procurementTagKeys`, `shareKeys`, `APP_NAME` demoted; `priorityVariants` removed entirely (no longer exists).
- **Web §C2 type (majority):** `DriveListSource`, `UploadStatus/Task/Owner`, `DisplayOwnerType`, `ActionInputType`, `SchedulePreset`, `EntityOption`, `ResourceGroupMember`, `ContactPanelMode`, `ProjectTab`, `DetailPanelVariant`, `ContactListMeta`, `ContactTagView`, `DriveEntryType`, `ProcurementTagRef`, `IssueTagRef`, `ListMeta`(×2), `IssueReferenceInput`, `SearchHitType`, `ShareType`, `PublicDocumentBody`, `ResolvedWorklist`, `FetchUserResult`, `SystemStatus` — all now `type`/`interface` without `export`.

Justified keeps (audit snapshot was pre-remediation; they now have a real external importer, so `export` is correct — **not** a miss):
- `settingKeys` (`api/settings.ts:16`) — imported by `admin/-settings-shared.tsx:15` (FIX-AUDIT-025 settings-layer refactor).
- `ShareTarget` (moved to `share/use-share.ts:8`) — imported by `share/share-dialog.tsx:17`.

Genuine residual needless exports (still `export`, **zero** external importer tree-wide):
- `PROJECT_TABS` — `app/routes/_app/projects/-project-tabs.ts:7` (only the derived `ProjectDetailTab`/`PROJECT_TAB_TO`/`activeProjectTab` are consumed externally; the base const is not).
- `DrainedBlob` barrel re-export — `apps/api/src/modules/file/index.ts:12` (the dead-code-api §3 "3 barrel" item; the other two, `listReferencesByOwner`/`totalStoredBytes`, were removed via RA-009).
- `PreviewKind` — `app/routes/_app/-file-preview-types.ts:9`.
- `Attachment` — `shared/lib/api/documents.ts:70`.

Item is low-severity, lint-level, explicitly discretionary ("drop `export` where module-local; keep for stable API surface"). ~45 of ~50 cited symbols addressed; the 4 above remain needlessly exported with no consumer.
- Method: per-symbol `export`-keyword grep + external-importer cross-check.

## REFACTOR-AUDIT-009 — Resolve 2 test-only API functions
**Verdict: VERIFIED-FIXED** (resolved by removal — not-public-API intent honored)

- `listReferencesByOwner` (was `file.service.ts:411`) — gone tree-wide (`rg` = 0): function, its tests, and the barrel re-export (`file/index.ts:20`) all removed.
- `totalStoredBytes` (was `file.service.ts:573`) — gone tree-wide (`rg` = 0): function + tests + barrel re-export (`file/index.ts:25`) removed.
- `file/index.ts` export block now lists only live symbols (`addReference`, `releaseReferenceTx`, `listAttachmentsByOwner`, …) — neither dead function re-exported.
- Method: tree-wide `rg` + barrel inspection.

## REFACTOR-AUDIT-010 — Move `shadcn` CLI to devDependencies
**Verdict: VERIFIED-FIXED**

- `apps/web/package.json`: `shadcn` is in **`devDependencies`** (`4.7.0`) and **absent from `dependencies`** (verified via `json.load`).
- Method: parse package.json `dependencies` vs `devDependencies`.

## REFACTOR-AUDIT-011 — Document undocumented env vars
**Verdict: VERIFIED-FIXED**

- `.env.example` documents both:
  - `VITE_REQUEST_ACCESS_EMAIL` — `:273` with a full doc block (purpose: mailto on access-denied page, references `denied.tsx`; unset hides the link). Source still references it (`denied.tsx:35`).
  - `ROOT_DIR` — `:18`, `:24`, `:45` with explanatory comments (project root for relative-path resolution). Source still references it (`config.ts:11,34` ← `root.ts`).
- Method: `find .env.example` + `rg` of both names in the file and in source.

---

## Summary

| Item | Verdict |
|------|---------|
| REFACTOR-AUDIT-002 | **PARTIAL** |
| REFACTOR-AUDIT-003 | VERIFIED-FIXED |
| REFACTOR-AUDIT-004 | VERIFIED-FIXED |
| REFACTOR-AUDIT-005 | VERIFIED-FIXED |
| REFACTOR-AUDIT-006 | VERIFIED-FIXED |
| REFACTOR-AUDIT-007 | VERIFIED-FIXED |
| REFACTOR-AUDIT-008 | **PARTIAL** |
| REFACTOR-AUDIT-009 | VERIFIED-FIXED |
| REFACTOR-AUDIT-010 | VERIFIED-FIXED |
| REFACTOR-AUDIT-011 | VERIFIED-FIXED |

**Non-VERIFIED items:**
- **RA-002 (PARTIAL)** — `api-response.ts` deleted; `pagination.ts` retained but no longer dead (`parsePageQuery` wired into issue/procurement/ship routes by FIX-AUDIT-016). Benign/justified divergence from the literal "delete both"; not a defect, flagged for the record.
- **RA-008 (PARTIAL)** — vast majority of value/type exports demoted; 4 cited symbols still carry a needless `export` with no external consumer: `PROJECT_TABS` (`-project-tabs.ts:7`), `DrainedBlob` barrel re-export (`file/index.ts:12`), `PreviewKind` (`-file-preview-types.ts:9`), `Attachment` (`api/documents.ts:70`). Low-severity, lint-level, discretionary.

No NOT-FIXED / REGRESSED items. No source/dependency/config/schema files were modified; only this report was written.
