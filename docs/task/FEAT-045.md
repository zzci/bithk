# FEAT-045 Upgrade the update system to the bun-tpl lode SDK with operator controls

- Status: Completed
- Plan: [PLAN-097](../plan/PLAN-097.md)
- Owner: local-session
- Updated: 2026-06-24

## Goal

bithk's lode update integration is read-only: a hand-rolled `apps/api/src/lode/`
module with a lock-free state writer, a basic summary, and no operator controls.
The `zzci/bun-tpl` template (lode module rewritten 2026-06-24) replaces the
hand-rolled protocol code with the official vendored SDK (flock-serialised
state writes), exposes audited restart/update/rollback/hold endpoints, and ships
a functional operator UI on the About tab.

Bring bithk's update system to parity: vendor the official lode SDK, re-implement
the thin glue with an enriched summary and the four operator actions, add the
audited admin endpoints, restore functional operator controls in the About UI,
and migrate the env contract from `LODE_DATA_DIR` to `LODE_DIR`.

## Scope

- Add vendored `apps/api/src/lode/sdk.ts` (canonical `dotns/lode@v0.0.9`
  `sdks/lode.ts`, `@ts-nocheck`); rewrite `lode/index.ts` as glue (enriched
  `getLodeSummary`, `reportLodeServing`, `startLodePrepareWatcher`,
  `captureLodeConfigBaseline`, `requestLodeRestart`, `requestLodeUpdate`,
  `requestLodeRollback`, `setLodeHold`); delete the superseded
  `state/readiness/prepare/summary/types` files + tests; port `lode/index.test.ts`.
- Migrate env contract to the canonical `DATA_DIR > LODE_DIR > ROOT_DIR` model:
  `config.ts` drops `LODE_DATA_DIR`, `deploy/lode.toml` `data_dir` → `dir`, env
  docs + tests. v0.0.9 rejects old names (no aliases), so the deployed lode
  binary must be upgraded to v0.0.9 in lockstep.
- Add four audited admin `POST` endpoints (`/system/lode/{restart,update,
  rollback,hold}`) to `system.routes.ts` using bithk's existing OpenAPI helpers;
  rewrite `system.routes.test.ts`.
- Rewire boot (`index.ts`/`app.ts`): `markLodeReady` → `reportLodeServing`, add
  `captureLodeConfigBaseline`.
- Port the richer `LodeCard` into `-settings-about.tsx` (banners, history,
  action buttons, switch-version input, confirm dialog) + four mutations; update
  `-settings-about.test.tsx`; add en/zh `about.lode.*` i18n keys.
- Update `docs/architecture.md`, `docs/changelog.md`, regenerated API
  spec/routes; optional `docs/decisions/` note for the env-var shim.

Out of scope: artifact signing, zero-downtime restart modes, `scripts/package.ts`
(already emits `lode/v1`), the lode supervisor binary itself.

## Acceptance

- The vendored SDK owns the `state.json` contract; operator writes are
  flock-serialised. The hand-rolled `state/readiness/prepare/summary/types`
  files are removed and nothing else imports them.
- `/system/lode/{restart,update,rollback,hold}` are admin-only, validated, and
  each records an audit event; they return `409` when not under lode and `422`
  on invalid input.
- The About tab shows an update-available banner, config-changed banner, hold
  banner, lifecycle rows, version history, and working restart/update/rollback/
  hold controls behind a confirm dialog.
- The app resolves its data dir as `DATA_DIR > LODE_DIR > ROOT_DIR` (no
  `LODE_DATA_DIR`); `deploy/lode.toml` uses `dir`; env docs regenerated; the
  deployed lode binary is v0.0.9.
- No bun-tpl encryption-lock readiness branch is introduced (bithk has no
  encryption module).
- `bun run check` passes.

## Notes

- 2026-06-24 — Created from PLAN-097 investigation. Latest SDK = `dotns/lode`
  v0.0.9 (vendored). Implementation is gated on operator confirmation that the
  deployed lode binary is/will be v0.0.9 (lockstep env-contract cutover —
  `data_dir`/`LODE_DATA_DIR` → `dir`/`LODE_DIR`, no aliases). Do not implement
  before approval.
- 2026-06-24 — Approved (Option A, no back-compat shim) and completed.
  `bun run check` EXIT 0. **Deploy reminder:** upgrade the production lode
  supervisor binary to v0.0.9 in the same release (old `data_dir`/`LODE_DATA_DIR`
  names are rejected by v0.0.9). Not committed.
- 2026-06-24 — Bumped vendored SDK to **v0.0.10** and reused its `readConfig()`
  (`LODE_CONFIG`) to surface a safe, read-only slice of `lode.toml`'s `[update]`
  (policy/channel/asset/source) in the About card, with secret redaction. Deploy
  target is now lode **v0.0.10** (the config display degrades gracefully on older
  binaries). `bun run check` EXIT 0.
