# Audit — Dimension: dead-code-deps (dependency + data deadweight)

> Campaign: `l1-w6c655lo-audit-20260602135842` · L3 worktree `bkd/oltuhz7h` · AUDIT-ONLY (no code changes)

## Summary

Scope: (a) dependency hygiene across root + `apps/*` + `packages/*` `package.json`,
(b) Drizzle schema vs. usage (unused tables/columns), (c) env-config schema vs. references.

Methods:

- **knip** (`bunx knip` filtered to `dependencies,unlisted,unresolved,binaries`) — used only as a *lead generator*. Its raw output is **unreliable here**: it failed to load `apps/web/vite.config.ts` / `vitest.config.ts` and could not resolve the `@/` path alias (1817 "unresolved imports"), so every one of its 15 "unused dependencies" and 166 "unused files" is a false positive caused by un-parsed imports. Every dep verdict below was therefore re-derived by **ripgrep import-search**, not taken from knip.
- **ripgrep cross-verification** — per-dependency `import`/`from` search; per-table/column symbol search across `apps/api/src`; per-env-key search of `configSchema` keys, `process.env`/`Bun.env`/`import.meta.env` access, and `.env.example`.

Note: knip mutated `bun.lock` ("Saved lockfile") during analysis; restored via `git checkout -- bun.lock package.json` before committing. Working tree contains only this report.

Totals by severity: **critical = 0 · high = 0 · medium = 1 · low = 4**

| # | Area | Severity | Confidence | Finding |
|---|------|----------|------------|---------|
| DEP-1 | deps / shared pkg | medium | high | `packages/shared` (`@app/shared`) is orphaned — imported by neither app |
| DEP-2 | deps / web | low | high | `shadcn` CLI declared as a runtime `dependency` |
| DEP-3 | deps / root+api | low | high | `consola` + `otpauth` declared twice (root + api) |
| ENV-1 | env / web | low | high | `VITE_REQUEST_ACCESS_EMAIL` consumed but undocumented |
| ENV-2 | env / api | low | medium | `ROOT_DIR` read at runtime, absent from `configSchema` |

Clean dimensions (verified, no findings): **DB tables**, **DB columns** — see §3.

---

## 1. Dependency deadweight

### DEP-1 — `packages/shared` is an orphaned workspace package — medium / high
- `apps/api/package.json:30` — `"@app/shared": "workspace:*"` declared, **never imported** anywhere in `apps/api` (grep for `@app/shared`, `ecies`, `secp256k1`, `ApiResponse` import = 0 hits in api src/scripts/tests).
- `apps/web/package.json:21` — `"@app/shared": "workspace:*"` declared, **never imported** anywhere in `apps/web` (grep = 0 hits).
- `packages/shared/package.json:22` — `"@noble/secp256k1": "3.1.0"` is therefore transitively dead: the only consumer of `@app/shared`'s ECIES code is the package's own `packages/shared/test/ecies.test.ts`.
- Method: ripgrep (whole-repo search for `@app/shared`, `@noble`, `ecies`, `secp256k1`, `ApiResponse`, and relative `packages/shared` paths — the only non-self references are `docs/` and the package's own README/bunfig).
- rationale: the package's stated purpose ("ECIES utilities shared between api and web") never materialised — auth uses session tokens, not client-side crypto; api even re-declares its own `ApiResponse<T>` in `apps/api/src/shared/lib/api-response.ts:35`, duplicating `packages/shared/src/index.ts`.
- suggested action: remove `packages/shared` (and the two `@app/shared` workspace deps + `@noble/secp256k1`), or, if intentionally retained for downstream forks, document it as a template-only package in `docs/`. (Removal deferred to an approved follow-up campaign — audit-only.)

### DEP-2 — `shadcn` CLI shipped as a runtime dependency — low / high
- `apps/web/package.json:51` — `"shadcn": "4.7.0"` sits under `dependencies`, but the package is a **CLI tool** (config `apps/web/components.json` present) with **zero source imports** (`grep "shadcn"` in `apps/web/src` = 0).
- Method: ripgrep (0 import sites) + confirmed `components.json` exists (CLI-driven, invoked via `bunx shadcn …`).
- rationale: a build-time/scaffolding CLI in `dependencies` is pulled into the production install graph for no runtime benefit.
- suggested action: move to `devDependencies`, or drop entirely and invoke via `bunx shadcn@latest` on demand.

### DEP-3 — duplicate dependency declarations: `consola`, `otpauth` — low / high
- `package.json:54` (`consola` 3.4.2, root devDep) ↔ `apps/api/package.json:32` (`consola` 3.4.2, api dep).
- `package.json:58` (`otpauth` 9.5.1, root devDep) ↔ `apps/api/package.json:38` (`otpauth` 9.5.1, api dep).
- Method: ripgrep — both are genuinely used in each scope (root: `scripts/clean.ts` uses `consola`, `tests/e2e/modules/account/totp.test.ts` uses `otpauth`; api: `src/shared/lib/logger.ts`+`src/cli.ts` use `consola`, `src/modules/account/users/totp.service.ts` uses `otpauth`), so neither declaration is *unused* — only duplicated.
- rationale: two pins of the same package risk silent version drift on a future bump; currently versions match, so impact is low.
- suggested action: accept as-is (versions aligned) or hoist to a single root pin if the workspace tooling resolves it for both. Not a removal candidate.

> Verified NOT unused (do not flag): `@eslint-react/eslint-plugin`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` (root devDeps) have 0 source imports but are **required peers of `@antfu/eslint-config`'s react preset** (`eslint.config.ts` sets `react: true`); they are loaded by ESLint at lint time. `@types/bun`, `@types/qrcode`, `@types/react`, `@types/react-dom` are ambient-type devDeps (no import sites expected). `@nsio/nsl` is a binary-only dep (`nsl run …` in the `dev` scripts). All API runtime deps (`cac`, `cronbake`, `drizzle-orm`, `hono`, `nanoid`, `oauth4webapi`, `pino`, `qrcode`, `zod`) and all web deps except the above resolved to ≥1 real import site.

---

## 2. Environment-variable deadweight

The API `configSchema` (`apps/api/src/config/schema.ts`) and `.env.example` are held in sync by the `check:env-docs` gate (`scripts/gen-env-docs.ts`). All 48 schema keys resolve to ≥11 references each (loader + settings-mirror + docs + tests + consumers); spot-checks of the lowest-signal keys (`OIDC_LOGOUT_URL`, `SINGLE_USER_NAME/EMAIL`, `OAUTH_PKCE`, `BACKUP_EXPORT_MIN_INTERVAL_SECONDS`, `DEFAULT_ADMIN`) confirmed a real `config.<KEY>` consumption site for each → **no unused declared env vars**. Two hygiene gaps remain on env vars that live *outside* that gated schema:

### ENV-1 — `VITE_REQUEST_ACCESS_EMAIL` consumed but undocumented — low / high
- `apps/web/src/app/routes/denied.tsx:35` — `import.meta.env.VITE_REQUEST_ACCESS_EMAIL ?? ""`.
- Method: ripgrep (`import.meta.env.VITE_*` scan + `.env.example` cross-check). The var is **not** declared in `.env.example`, **not** mirrored in `apps/web/vite.config.ts` (unlike `VITE_APP_NAME`/`VITE_APP_DISPLAY_NAME`, which are injected from `APP_NAME`/`APP_DISPLAY_NAME` at lines 11–12), and **not** covered by `check:env-docs` (which only audits the API schema).
- rationale: a build-time feature toggle that silently defaults to empty if an operator never learns it exists; the "request access" email link on the denied page is effectively dead unless the var is set in the build env.
- suggested action: document `VITE_REQUEST_ACCESS_EMAIL` in `.env.example` (and ideally extend the env-docs check to `VITE_*`), or remove the unused read if the feature is abandoned.

### ENV-2 — `ROOT_DIR` read at runtime, absent from the schema — low / medium
- `apps/api/src/root.ts:12` — `if (process.env.ROOT_DIR) return resolve(process.env.ROOT_DIR)`.
- Method: ripgrep (direct `process.env.*` scan vs. `configSchema` keys; `ROOT_DIR` appears only as a comment in `.env.example:36`).
- rationale: a legitimate **pre-config bootstrap** knob (it resolves the project root *before* `configSchema` is parsed, so it cannot live in the schema), but it is undocumented as a settable variable, so confidence that it is "intended public config" is only medium.
- suggested action: add a documented `# ROOT_DIR=` comment row to `.env.example`, or leave as an intentional internal knob and note it in `docs/reference/env-reference.md`. No code change required.

---

## 3. Database / data — verified clean (no findings)

### Tables — no dead tables
All ~40 `sqliteTable` definitions across `apps/api/src/modules/**/schema.ts` are referenced by query code outside their defining schema file. Symbols that grepped to a single file (`pkceChallenges`, `userTotpDevices`, `documentPins`, `globalProcurementCategories`) were confirmed to be **fully CRUD-exercised within that one service** (e.g. `auth.service.ts`, `totp.service.ts`, `document.service.ts`, `project.global-categories.ts`) — single-file ≠ dead. Method: ripgrep per table-export symbol.

### Columns — no dead columns detected
Every distinctively-named column was grepped for `.<col>` / insert-value / select usage outside its schema file. All resolved to real read **and** write sites. The two columns that grepped to a single file were verified read+written:
- `user_totp_devices.last_used_timestep` — `apps/api/src/modules/account/users/totp.service.ts:81,85,170,174` (replay-window guard, read + updated).
- `shares.download_count` — `apps/api/src/modules/share/share.service.ts:65,88,374` (exhaustion check + atomic increment).
Spot-checked further: every `ships` spec column (`imoNumber`, `mmsi`, `callSign`, `flagState`, `registryPort`, `ownerName`, `grossTonnage`, `lengthOverall`, `buildYear`, …), `shipEquipment.serialNumber/installedAt`, `worklists.checklist/precautions`, `contacts.taxId/confidential`, `procurementDetails.currency/quantity/amount`, `shares.maxDownloads/permission/password`, `driveFileVersions.versionNo`, `itemComments.isInternal/replyToId`, `projectRoles.kind/isSystem/capabilities`, `projectMembers.title/displayName`, `issueReferences.label` — all referenced by service code. Method: ripgrep per column identifier.

---

## Method / scope notes

- READ-ONLY audit; the only changed file is `docs/audit/dead-code-deps.md`. No `package.json`/lockfile/schema/code edits.
- knip's lockfile mutation was reverted with `git checkout -- bun.lock package.json` prior to commit.
- File-level dead code (e.g. knip's "unused files" list of barrel `index.ts`, `*.backup.ts`, editor components) is **out of this dimension's scope** — deferred to the `dead-code-api` / `dead-code-web` L3s. Cross-verification incidentally confirmed several of knip's flagged files (editor/codemirror/milkdown/pdf chains) are in fact reachable from route/panel code, so that list should be treated with the same caution.
