# Dead-Code Audit — `apps/api`

**Dimension:** dead-code-api (unused exports, unreferenced files/modules, orphaned helpers, needless exports, dead branches, commented-out code)
**Scope:** `apps/api/src` — all `modules/*`, plus `routes`, `db`, `config`, `shared` (lib/middleware/test).
**Methods:**
- `bunx ts-prune -p apps/api/tsconfig.json` (ephemeral)
- `bunx knip --workspace apps/api` (ephemeral) — **ran degraded**: knip failed to load `apps/api/drizzle.config.ts` (`File '@app/tsconfig/base.json' not found`) and could not resolve the `@/*` path alias, so it could not follow most imports. Its **"Unused files (45)"** and **"Unused exports (104)"** lists are largely false positives (see §4). Treated only as candidate hints.
- `ripgrep` cross-verification of **every** candidate (per-file occurrence counts, test vs. production split, dynamic-wiring check). No finding is reported on tool output alone.

**Confidence rule applied:** HIGH = ripgrep confirms zero production references AND no Drizzle-codegen / barrel-side-effect / dynamic-import risk. Downgraded otherwise.

## Totals by severity
| Severity | Count |
|----------|-------|
| critical | 0 |
| high     | 0 |
| medium   | 2 |
| low      | 16 |
| **total**| **18** |

Dead code is a maintainability/clarity concern, not a runtime defect — hence no critical/high. The two `medium` items are whole orphaned files that masquerade as core infrastructure.

---

## 1. Confirmed dead — removable as-is (HIGH confidence)

### Orphaned files (no importer anywhere)
- `apps/api/src/shared/lib/api-response.ts:1` — severity: medium — confidence: high
  rationale: entire file has **zero importers** (`rg "api-response"` repo-wide = 0 hits outside itself); its own header comment states call sites use inline `c.json({ success: true, data })` instead. Exports `ApiMeta:15`, `ApiSuccess:21`, `ApiError:27`, `ApiResponse:35`, `ok:37`, `paged:46`, `err:50` — all unused. Method: knip(file) + ts-prune + grep.
  suggested action: delete the file.

- `apps/api/src/shared/lib/pagination.ts:1` — severity: medium — confidence: high
  rationale: zero importers; its only consumer of `parsePageQuery:23` is the dead `api-response.ts` above. Exports `PageQuery:12`, `parsePageQuery:23`. Forms a dead cluster with api-response.ts. Method: knip(file) + grep.
  suggested action: delete the file (together with api-response.ts).

### Dead exports (defined, exported, never referenced — not even in-module)
- `apps/api/src/shared/middleware/request-id.ts:27` — `withRequestIdHeader` — severity: low — confidence: high
  rationale: only two occurrences repo-wide — its own definition and a mention in its own JSDoc (`:9`); never called. The `requestId` middleware in the same file is used; this helper is not. Method: ts-prune + grep.
  suggested action: remove the `withRequestIdHeader` export.

- `apps/api/src/shared/middleware/totp.ts:19` — `requireTotpStepUp` — severity: low — confidence: high
  rationale: dead alias `export const requireTotpStepUp = requireTotp`. The 4 importers of `totp.ts` import `requireTotp` (the original), never the alias. Method: ts-prune + grep.
  suggested action: remove the alias line.

- `apps/api/src/modules/file/permission.ts:52` — `listRegisteredOwnerTypes` — severity: low — confidence: high
  rationale: exported function, single occurrence repo-wide (its definition); zero references. Method: ts-prune + grep.
  suggested action: remove the export.

- `apps/api/src/modules/file/storage/registry.ts:56` — `listRegisteredDrivers` — severity: low — confidence: high
  rationale: exported function, single occurrence repo-wide; zero references. Method: knip + grep.
  suggested action: remove the export.

- `apps/api/src/modules/item/item.service.ts:430` — `makeCommentValidationError` — severity: low — confidence: high
  rationale: exported function, single occurrence repo-wide; zero references. Method: knip + grep.
  suggested action: remove the export (and the `ValidationError` import if it becomes unused).

---

## 2. Production-dead — kept alive only by their own tests (MEDIUM confidence)

These functions have **no production caller**; the sole references are in `file.test.ts`. They are dead in the shipped surface; removing them means dropping their tests too.

- `apps/api/src/modules/file/file.service.ts:411` — `listReferencesByOwner` — severity: low — confidence: medium
  rationale: referenced only by `file.test.ts` and re-exported (unused) via `file/index.ts:20`; no production call site. Method: grep (test-vs-prod split).
  suggested action: confirm with owner whether it is intended public API; if not, remove function + its tests + the barrel re-export.

- `apps/api/src/modules/file/file.service.ts:573` — `totalStoredBytes` — severity: low — confidence: medium
  rationale: referenced only by `file.test.ts` and re-exported (unused) via `file/index.ts:25`; no production call site. Method: grep.
  suggested action: same as above — verify intent before removing.

---

## 3. Needless `export` — used only inside the defining file (LOW)

Live code (referenced in-module, so **not** dead), but the `export` keyword is unnecessary surface. ts-prune marks each as "used in module"; grep confirms zero external consumers. Demote to file-local.

- `apps/api/src/modules/ship/ship.service.ts:83` — `composeShip` — severity: low — confidence: high — used 3× in-file; no external use → drop `export`.
- `apps/api/src/modules/ship/ship.worklist.service.ts:28` — `composeWorklist` — severity: low — confidence: high — in-file only → drop `export`.
- `apps/api/src/modules/account/auth/auth.service.ts:378` — `updateSessionTokens` — severity: low — confidence: high — in-file only → drop `export`.
- `apps/api/src/modules/account/auth/auth.service.ts:407` — `isSessionExpired` — severity: low — confidence: high — in-file only → drop `export`.
- `apps/api/src/modules/account/auth/auth.routes.ts:127` — `rateLimitKey` — severity: low — confidence: high — used 5× in-file; no external use → drop `export`.
- `apps/api/src/modules/project/project.global-categories.ts:32` — `resolveGlobalCategory` — severity: low — confidence: high — in-file only → drop `export`.
- `apps/api/src/modules/file/orphan-sweep.ts:38` — `listOrphanReferences` — severity: low — confidence: high — called once in-file by `runOrphanSweepOnce`; no external use → drop `export`.

### Needless barrel re-exports (`file/index.ts`) — no consumer
- `apps/api/src/modules/file/index.ts:12` — `DrainedBlob` type re-export — severity: low — confidence: medium — type is used in-module in `file.service.ts`, but the barrel re-export has no external consumer → remove from barrel.
- `apps/api/src/modules/file/index.ts:20` — `listReferencesByOwner` re-export — severity: low — confidence: high — re-export of a production-dead function (§2) with no consumer → remove from barrel.
- `apps/api/src/modules/file/index.ts:25` — `totalStoredBytes` re-export — severity: low — confidence: high — same as above → remove from barrel.

> Note: the broad `module/index.ts` and `policy/index.ts` barrels re-export many symbols that ts-prune/knip flag as "no external consumer." These are **intentional public-API surface** for each module and several are consumed via the barrel elsewhere; they are **not** reported as dead. Only the three `file/index.ts` entries above pair a barrel re-export with a confirmed unused/dead target.

---

## 4. Cleared false positives (do NOT remediate)

Explicitly verified as **live**, to stop downstream remediation from chasing tool noise.

### 4a. Drizzle codegen entry point — entire `db/schema.ts` cluster
ts-prune reported ~70 "unused" exports in `apps/api/src/db/schema.ts` (every table & enum, e.g. `users`, `projects`, `ships`, `driveEntries`, `PROJECT_STATUSES`, …). **All false positives.** `db/schema.ts` is the Drizzle migration/codegen entry (`apps/api/drizzle.config.ts` → `schema: "./src/db/schema.ts"`) and is imported by tests as `import * as schema from "@/db/schema"`. The barrel `export *`-aggregates each module schema; the tables are consumed directly from `@/modules/*/schema` by services. **Keep all.**

### 4b. Module `schema.ts` files flagged "unused" by knip
`drive/schema.ts`, `document/schema.ts`, `issue/schema.ts`, `item/schema.ts`, `references.schema.ts`, `account/groups/schema.ts`, etc. — flagged only because knip could not resolve `@/*` aliases. Each is `export *`-aggregated by `db/schema.ts` and imported directly by its service. **Keep all.**

### 4c. knip "Unused files" that are actually imported (degraded run)
Of knip's 45 "unused files," ripgrep confirms importers for nearly all, e.g.: `shared/middleware/auth.ts` (51 importers), `shared/lib/id.ts` (27), `shared/test/route-harness.ts` (6 test importers), `shared/middleware/totp.ts` (4), `modules/item/comment.routes.ts` (4), `modules/item/comment.service.ts` (2), `modules/item/item.routes.ts` (1, via `item/index.ts`), `modules/drive/drive.file-permission.ts` (1, via `drive/index.ts`), `modules/account/account.backup.ts` (5), `shared/lib/content-disposition.ts` (2), `shared/middleware/auth-registry.ts` (3). Every module `index.ts` barrel is imported by `routes/protected.ts` / `routes/public.ts`. **Only `api-response.ts` and `pagination.ts` (§1) genuinely had 0 importers.**

### 4d. knip "Unused exports" disproven by grep (alias-resolution failure)
The following knip-flagged exports have real production consumers and are **live**: `parseDefaultAdmins` (← `shared/lib/app-config.ts`), `deleteUserSessions` (← `backup/restore.routes.ts`), `oauthSessionAuthProvider` (← `account/index.ts`, `registerAuthProvider` side-effect), `releaseReferenceTx`/`finalizeReleasedBlob`/`listAttachmentsByOwner`/`makeAttachmentView` (← project/document/issue/item routes), `buildReferenceRows` (← `issue.service.ts`), `setItemPinned`/`listPinnedByProject` (← issue/procurement/item routes), `resolveCategory` (← `procurement.service.ts`), `composeProject`/`createProjectTx` (← `ship.service.ts`), `registerProjectCoverPermissionHook`/`registerShipCoverPermissionHook` (← module `index.ts` side-effects), `deleteResourceTags`/`listResourceIdsByAnyTag` (← multiple services), `isOAuthConfigured`/`isSingleUserMode`/`getSingleUserConfig` (← `auth.routes.ts`), `maxAttachmentsPerResource`/`incrementUploadsUsed`/`decrementUploadsUsed` (← system routes / file.service), `registerShareAdapter` (← `share/index.ts`). **Keep all.**

### 4e. Commented-out code / dead branches
Scanned for commented-out code blocks and unreachable branches. Found only legitimate explanatory prose comments (e.g. `auth.service.ts:364`, `cron.routes.ts:338`, `policy/middleware.ts:212`); **no commented-out code blocks and no dead branches** identified.

---

## Remediation summary (for the dedicated removal campaign)
1. Delete `shared/lib/api-response.ts` + `shared/lib/pagination.ts` (dead cluster).
2. Remove 5 dead exports: `withRequestIdHeader`, `requireTotpStepUp`, `listRegisteredOwnerTypes`, `listRegisteredDrivers`, `makeCommentValidationError`.
3. Decide intent on the 2 test-only functions (`listReferencesByOwner`, `totalStoredBytes`) before removing.
4. Demote 7 needless exports to file-local + trim 3 `file/index.ts` barrel re-exports.
5. Do **not** touch §4 items — they are tool false positives.
