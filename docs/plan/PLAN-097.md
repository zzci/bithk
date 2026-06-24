# PLAN-097 - Upgrade the update system to the bun-tpl lode SDK with operator controls

- Status: Completed
- Task: [FEAT-045](../task/FEAT-045.md)
- Campaign: local
- Created: 2026-06-24
- Approved: 2026-06-24 (Option A, no back-compat shim)
- Completed: 2026-06-24

## Context

The "update system" is the lode supervisor integration: lode downloads, verifies,
runs, and auto-updates the packaged release asset, and communicates with the app
through `state.json`. bithk's current integration was realigned to the `lode/v1`
spec in PLAN-082 (FIX-040, 2026-06-15) and is **read-only**.

Current state in bithk:

- `apps/api/src/lode/` is a hand-rolled module split across `state.ts`,
  `readiness.ts`, `prepare.ts`, `summary.ts`, `types.ts` (+ 4 unit tests). It
  implements the readiness/prepare handshake and a read-only summary only.
- `state.ts.patchState` is a **lock-free** atomic temp+rename writer. PLAN-082
  risk #3 accepted this explicitly because lode does not concurrently mutate
  `ready` while waiting for the prepare ack — true for readiness, but **not** true
  for operator writes (`target` / `restart_nonce` / `hold`), which race lode.
- `getLodeSummary()` exposes: `configured`, `active`, `status`, `current`,
  `available`, `lastCheckAt`, `lastError`, `stateStatus`, `readiness.{ready,phase}`,
  `update.{configStatus,policy,channel,asset,sourceType,source}`. No `lastGood`,
  no `history`, no `hold`, no `rollbackTarget`, no config-change detection.
- `/system/version` (admin) returns `BUILD_INFO + getLodeSummary()`; the lode
  field is typed `z.unknown()` in the OpenAPI schema, so its shape is not pinned.
- There are **no** operator endpoints (no restart/update/rollback/hold).
- The About tab (`apps/web/src/app/routes/_app/admin/-settings-about.tsx`,
  PLAN-074) renders the summary read-only. Commit `e0ff36a` (2026-06-19) deleted a
  "Manual operations" block because it was hardwired to "Unsupported" — the app
  never exposed functional lode controls.
- Env contract: the app reads `LODE_DATA_DIR` (`config.ts.resolveDataDir` →
  `resolve(LODE_DATA_DIR, "data")`); `deploy/lode.toml` uses `[global] data_dir`.
- The only importers of `@/lode` are `apps/api/src/index.ts` (boot wiring) and
  `apps/api/src/modules/system/system.routes.ts`, both via the barrel.

Reference — `zzci/bun-tpl` (lode module rewritten 2026-06-24, commit "replace the
single-binary build with the lode upgrade system"):

- Vendors the official single-file SDK `apps/api/src/lode/sdk.ts` (from
  `dotns/lode`, v0.0.9, `@ts-nocheck`). The SDK owns the entire `state.json`
  contract: a **flock(2)-serialised** read-modify-write (real lock under Bun via
  `bun:ffi`, lock-free atomic rename as fallback), readiness, the prepare
  handshake, and the `restart`/`update`/`rollback`/`hold` requests.
- `lode/index.ts` is thin app glue over the SDK:
  - richer `getLodeSummary()`: adds `supervised`, `stateAvailable`, `lastGood`,
    `activeVersion`, `readinessMode`, `hold`, `configGeneration`, `configChanged`,
    `history[]`, `updateAvailable`, `rollbackTarget`.
  - `reportLodeServing()` (replaces `markLodeReady`), `startLodePrepareWatcher()`
    (delegates to the SDK `watch`), `captureLodeConfigBaseline()`.
  - operator actions: `requestLodeRestart()`, `requestLodeUpdate(target)`,
    `requestLodeRollback(version?)`, `setLodeHold(held)`.
- `system.routes.ts` adds four admin `POST` endpoints — `/system/lode/restart`,
  `/system/lode/update`, `/system/lode/rollback`, `/system/lode/hold` — each
  validated and **audit-logged** (`auditLodeAction`), returning `409` when not
  running under lode.
- `-settings-about.tsx` renders a full `LodeCard`: update-available banner,
  config-changed banner, hold banner, lifecycle rows, version history, action
  buttons (restart / update latest / rollback / hold / switch-to-version), and a
  confirm dialog.
- Env contract: the SDK reads `LODE_DIR` (+ `LODE_INSTANCE`,
  `LODE_ACTIVE_VERSION`, `LODE_READINESS`, `LODE_WORKDIR`); `deploy/lode.toml`
  uses `[global] dir`; `config.ts` resolves `DATA_DIR > LODE_DIR > ROOT_DIR`.

Gap summary:

| Capability | bithk (now) | bun-tpl (target) |
| --- | --- | --- |
| Protocol owner | hand-rolled (5 files) | vendored official SDK |
| State write locking | lock-free temp+rename | flock(2) RMW + fallback |
| Summary richness | basic | +history / lastGood / hold / rollbackTarget / configChanged |
| Operator actions | none | restart / update / rollback / hold |
| Admin endpoints | read-only `/system/version` | + 4 audited POST routes |
| About UI | read-only | controls + banners + history |
| Env var | `LODE_DATA_DIR` / `data_dir` | `LODE_DIR` / `dir` |

### SDK version & env contract (authoritative — verified against `dotns/lode`)

- **Latest SDK = `dotns/lode` v0.0.9** (released 2026-06-24; `gh api
  repos/dotns/lode/releases/latest`). bun-tpl already vendors this version, and
  its `sdk.ts` body is **byte-identical** to the canonical `sdks/lode.ts` at the
  `v0.0.9` tag (verified by diff). We vendor from the canonical source.
- **v0.0.9 is a breaking release.** Per the lode CHANGELOG, "Directory variables
  renamed for a clear app-vs-lode split": lode's own dir is now `[global].dir` /
  `--dir` / **`LODE_DIR`** (was `data_dir` / `--data-dir` / `LODE_DATA_DIR`), and
  the run dir is `[command].workdir` / `LODE_WORKDIR`. Crucially: **"No silent
  aliases — old names are rejected."**
- Consequence for bithk: a v0.0.9 lode binary **rejects** `data_dir` in
  `lode.toml` and **never injects** `LODE_DATA_DIR`. bithk's current integration
  (realigned in PLAN-082 against an older lode) reads `LODE_DATA_DIR`, so under a
  v0.0.9 supervisor it would silently degrade to "not supervised." The env
  migration is therefore **mandatory and a correctness fix**, not just cosmetic.
- Authoritative app-side contract (lode `docs/integration.md` §2 / "Data
  directories"): lode injects `LODE_DIR`, `LODE_WORKDIR`, `LODE_INSTANCE`,
  `LODE_ACTIVE_VERSION`, `LODE_READINESS`; the app resolves its data dir as
  **`DATA_DIR > LODE_DIR > ROOT_DIR`**; concurrent `state.json` writers SHOULD
  take `flock(2)` on `$LODE_DIR/state.json.lock` (exactly what the SDK does).

## Proposal

Chosen approach: **Option A** — vendor the latest official SDK
(`dotns/lode` v0.0.9 `sdks/lode.ts`), re-implement the glue, expose audited
operator endpoints, restore functional operator controls in the About UI, and
migrate the env contract to the canonical `LODE_DIR` model. bithk lacks an
`encryption` module, so the encryption-lock readiness check in bun-tpl is **not**
ported.

1. Backend lode module
   - Add `apps/api/src/lode/sdk.ts`, vendored verbatim from the canonical
     `dotns/lode@v0.0.9` `sdks/lode.ts` (`@ts-nocheck`, "do not edit; re-vendor
     from upstream to update"). Pin the version + tag in the header comment so a
     later bump is a clean re-vendor, not a hand-edit. Confirm eslint
     ignores/tolerates the vendored file (antfu config); add an `ignores` entry
     in `eslint.config.ts` if it trips rules.
   - Rewrite `apps/api/src/lode/index.ts` as the thin glue, exporting the
     enriched `getLodeSummary`, `LodeSummary` / `LodeHistoryEntry` /
     `LodeActionResult` types, `reportLodeServing`, `startLodePrepareWatcher`,
     `captureLodeConfigBaseline`, and the four operator actions.
   - Delete the superseded `state.ts`, `readiness.ts`, `prepare.ts`,
     `summary.ts`, `types.ts` and their `*.test.ts` (their behaviour now lives in
     the SDK + the ported `index.test.ts`).
   - Port `apps/api/src/lode/index.test.ts` from bun-tpl (summary shape;
     actions return `not_active` when unsupervised; readiness/prepare wiring).

2. Env-contract migration to the canonical `LODE_DIR` model (mandatory; see Risks)
   - `config.ts`: replace the `LODE_DATA_DIR` resolution with the canonical
     `DATA_DIR > LODE_DIR > ROOT_DIR` order. **No back-compat shim** (per user
     direction): drop the `LODE_DATA_DIR` branch entirely — a clean lockstep
     cutover to v0.0.9.
   - `deploy/lode.toml`: `[global] data_dir` → `dir` (v0.0.9 rejects `data_dir`).
   - Deploy side: upgrade the running lode supervisor binary to v0.0.9 in the
     same release so it injects the `LODE_DIR` family.
   - Regenerate env docs (`bun run gen:env-docs`); update `.env.example`,
     `config.test.ts`, and the system route tests that set `LODE_DATA_DIR`.

3. `system.routes.ts`
   - Keep the existing read endpoints (`/health`, `/health/ready`,
     `/system/version`, `/metrics`, `/system/upload-limits`, `/system/branding`).
   - Add four admin `POST` endpoints — `/system/lode/restart`, `/update`,
     `/rollback`, `/hold` — using bithk's **existing** OpenAPI helpers
     (`describeRoute`, `resolver`, `validator` + `onValidationFailure`,
     `ErrorEnvelope`, the local `okJson`), not bun-tpl's `TAGS`/`SECURITY`/`jsonOk`
     (which bithk does not export). Guard with `authRequired` + `adminRequired`.
   - Add a local `auditLodeAction()` using bithk's `audit()` signature; record
     each action (actor, resourceType `lode`, detail). Return `409`
     `LODE_NOT_ACTIVE` when not under lode, `409` `LODE_NO_ROLLBACK_TARGET` when
     rollback has no target, `422` on invalid body.

4. Boot wiring (`index.ts` / `app.ts`)
   - Replace `markLodeReady` with `reportLodeServing` (same probe gate), add
     `captureLodeConfigBaseline()` after readiness, keep the prepare watcher and
     its teardown in `closeServices`.

5. Frontend About tab
   - Port the richer `LodeCard` into `-settings-about.tsx`: update-available /
     config-changed / hold banners, lifecycle rows, history section, action
     buttons, switch-to-version input, and a confirm dialog; add the four
     `useMutation` calls hitting the new endpoints and invalidating
     `["system","version"]`. This restores (now functional) what `e0ff36a`
     removed.
   - Update the `LodeStatus` TS interface to the enriched shape.

6. i18n, tests, docs
   - Add `about.lode.*` keys to `apps/web/src/locales/en/settings.json` and
     `apps/web/src/locales/zh/settings.json` (Chinese translations required for
     the zh bundle); keep `check:i18n` green.
   - Rewrite `system.routes.test.ts` for the new endpoints (admin-gated; audit
     recorded; `409` off-lode; `422` invalid body) and update
     `-settings-about.test.tsx`.
   - Regenerate the OpenAPI spec/route docs (`gen:api-spec`, `gen:api-docs`);
     update `docs/architecture.md` (upgrade-system section) and
     `docs/changelog.md`; add a `docs/decisions/` note if the `LODE_DATA_DIR`
     back-compat shim is kept.

## Risks

- **Env-contract migration is the dominant risk.** v0.0.9 renamed
  `data_dir`/`LODE_DATA_DIR` → `dir`/`LODE_DIR` with **no aliases (old names
  rejected)**. The app and the supervisor must be cut over **in lockstep**: ship
  the `LODE_DIR` app change, the `dir` lode.toml change, AND the v0.0.9 supervisor
  binary together. A version skew either way breaks the integration (an old
  binary won't inject `LODE_DIR`; a v0.0.9 binary rejects `data_dir`). **Operator
  must confirm the deployed lode binary is/will be v0.0.9 before implementation.**
- Operator writes (`target` / `restart_nonce` / `hold`) race lode's own writer;
  the lock-free `patchState` would be incorrect for them. The vendored SDK's
  flock RMW is required — do not bolt actions onto the old writer.
- restart / update / rollback are powerful, partly destructive controls.
  Admin-session only + audit + a confirm dialog. Decide whether PAT / service
  tokens are allowed (recommend admin session only).
- `sdk.ts` is `@ts-nocheck`; verify `bun run lint`/`typecheck` tolerate the
  vendored file (add an eslint `ignores` entry if it trips antfu rules).
- `/system/version` lode field is `z.unknown()`, so the enriched summary is not
  an API-spec break; but the About TS interface and i18n keys do change.
- Do not port bun-tpl's readiness encryption-lock branch — bithk has no
  `encryption` module; keep the DB-ping readiness probe as-is.

## Scope

- Backend: `apps/api/src/lode/sdk.ts` (new), `lode/index.ts` (rewrite),
  delete `lode/{state,readiness,prepare,summary,types}.ts` + tests,
  `lode/index.test.ts` (new), `config.ts`, `index.ts`, `app.ts`,
  `modules/system/system.routes.ts`, `modules/system/system.routes.test.ts`.
- Deploy/config: `deploy/lode.toml`, `Dockerfile` (`ENV LODE_DATA_DIR` →
  `LODE_DIR`), `.env.example`, env docs, `config.test.ts`.
- Frontend: `-settings-about.tsx`, `-settings-about.test.tsx`,
  `locales/en/settings.json`, `locales/zh/settings.json`.
- Docs: `docs/architecture.md`, `docs/changelog.md`, regenerated API spec/routes,
  optional `docs/decisions/` note for the env-var shim.
- Out of scope: artifact signing changes, zero-downtime restart modes, changes to
  `scripts/package.ts` (already emits a `lode/v1` manifest), the lode supervisor
  binary itself.

## Alternatives

- **Option A (CHOSEN)** — adopt the latest vendored SDK (v0.0.9) + glue +
  endpoints + UI, with the env-contract migration. Pros: correct concurrent
  writes (flock), full feature parity, tracks upstream (single source of truth),
  removes ~5 hand-rolled files. Cons: larger diff; requires the supervisor/env
  lockstep cutover.
- **Option B (additive minimal)** — keep the hand-rolled module, add the four
  operator actions on top of the existing lock-free `patchState`, plus the
  endpoints and UI; no env migration. Pros: smallest diff, no deployment
  coordination. Cons: lock-free writer **races lode** on `target`/`restart_nonce`/
  `hold` (correctness risk), further divergence from the template, duplicated
  protocol logic. Not recommended for write-heavy actions.
- **Option C (read-only enrichment)** — only enrich the summary (history,
  lastGood, …) with no operator controls. Does not meet the intent of
  operator-driven updates.

## Verification

- `bun run check` (lint + typecheck + test + routes + build + i18n + env-docs +
  api-docs + api-spec) passes.
- New unit tests: actions return `not_active` off-lode; endpoints are admin-gated
  and audited; `409` when unsupervised; `422` on invalid body; enriched summary
  shape.
- Manual under a lode supervisor: update-available banner appears when
  `available != current`; restart bumps `restart_nonce`; rollback targets
  `last_good`; hold sets/clears; About reflects state after invalidation.
- `bun run package` still emits a valid `lode/v1` manifest (unchanged).

## Annotations

- 2026-06-24 — Draft created from investigation of bithk vs `zzci/bun-tpl`
  (bun-tpl lode module rewritten same day). Awaiting approval; the `LODE_DIR`
  env-contract migration needs an operator decision before implementation.
- 2026-06-24 — Per user direction ("adopt the latest-version SDK"), verified
  against `dotns/lode`: latest = **v0.0.9** (released today), which bun-tpl
  already vendors and whose `sdks/lode.ts` body is byte-identical to the
  canonical tag. Confirmed v0.0.9 breaking rename `data_dir`/`LODE_DATA_DIR` →
  `dir`/`LODE_DIR` (no aliases). Locked Option A as the chosen approach; vendor
  from `dotns/lode@v0.0.9`; env migration is mandatory (correctness fix), with a
  required lockstep upgrade of the deployed lode binary to v0.0.9.
- 2026-06-24 — Implemented and verified. Vendored `lode/sdk.ts` (v0.0.9), rewrote
  `lode/index.ts` glue, deleted the 5 hand-rolled files + tests, ported
  `lode/index.test.ts` (12 pass), migrated config/lode.toml/env-docs to
  `LODE_DIR` (no shim), added 4 audited admin endpoints + rewrote
  `system.routes.test.ts` (24 pass), ported the operator About UI + 4 mutations
  + en/zh i18n, updated `-settings-about.test.tsx` (3 pass), added the
  `sdk.ts` eslint ignore, regenerated api-spec/api-routes, updated
  architecture.md + changelog. `bun run check` EXIT 0 (lint/typecheck/test/
  routes/build/i18n/env-docs/api-docs/api-spec all green). Not committed.
- 2026-06-24 — Per user direction, bumped the vendored SDK to **v0.0.10** (latest;
  adds `configPath()`/`readConfig()` reading `lode.toml` via the new `LODE_CONFIG`
  env). Restored the operator update-config display the old summary had: the glue
  parses `readConfig()` with `Bun.TOML.parse` and exposes a safe whitelist
  (`policy`/`channel`/`asset`/`owner-repo source`) as `summary.updateConfig`,
  redacting the manifest URL, auth headers, and trusted keys (manifest source ⇒
  `sourceType` only). Added an "Update configuration" section to the About card +
  en/zh i18n, and config-reading unit/route tests (lode/index 15 pass, system
  routes 25 pass). Deploy: lode binary should be **v0.0.10** (degrades gracefully
  to no config display on older binaries). `bun run check` re-run EXIT 0.
