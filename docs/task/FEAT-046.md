# FEAT-046 Port the enriched lode update-config surface from zzci/access

- Status: Completed
- Plan: [PLAN-098](../plan/PLAN-098.md)
- Owner: local-session
- Updated: 2026-07-01

## Goal

FEAT-045 (PLAN-097) brought bithk's update system onto the vendored lode SDK
(v0.0.10) and surfaced a **narrow** read-only slice of `lode.toml`'s `[update]`
table on the About tab: `policy`, `channel`, `asset`, `sourceType`, `source`
(manifest sources show the type only, never the host). This lives inline in
`apps/api/src/lode/index.ts` as `readUpdateConfig()` / `LodeUpdateConfig`.

The sibling fork `zzci/access` (same lode SDK, byte-identical `sdk.ts`) evolved
this further: it extracts config parsing into a dedicated `apps/api/src/lode/
config.ts` module that returns a richer, status-carrying `LodeConfig` and renders
a fuller config section on the About tab.

Bring bithk to that shape by porting the delta — the SDK, the four operator
endpoints, boot wiring, banners, history, and action controls are already at
parity and are **not** touched.

## Scope

- Add `apps/api/src/lode/config.ts` (ported from zzci/access): `readLodeConfig()`
  returning `LodeConfig` with a `status`
  (`not_configured | unreadable | malformed | available`) and the non-secret
  fields `app`, `sourceType`, `source`, `asset`, `channel`, `policy`,
  `checkInterval`, `keepVersions`, `pin`, `requireSignature`, `runtime`,
  `runtimeVersion`. Manifest sources surface **only the host** (`new URL().host`);
  secret-bearing tables (`[env]`, `[http].headers`, `[trust].trusted_keys`) are
  never read.
- Add `apps/api/src/lode/config.test.ts` (ported, sample identifiers adapted to
  bithk: `zzci/bithk`, `bit-linux-x64.tar.gz`).
- Refactor `apps/api/src/lode/index.ts`: import `readLodeConfig`/`LodeConfig`
  from `./config` (re-export the types); drop the inline `LodeUpdateConfig`,
  `readUpdateConfig`, `objectRecord`, `safeConfigString`, and the `readConfig`
  SDK import; change `LodeSummary.updateConfig?: LodeUpdateConfig` →
  `config: LodeConfig` (always present).
- Trim `apps/api/src/lode/index.test.ts`: move the config-surfacing assertions to
  `config.test.ts`; drop `LODE_CONFIG` from the saved-env list.
- Update `apps/api/src/modules/system/system.routes.test.ts`: assert the new
  `lode.config` shape (with `status: "available"`); keep the secret-redaction
  checks.
- Frontend `-settings-about.tsx`: rename `LodeStatus.updateConfig` → `config`;
  replace `LodeUpdateConfig` with the richer `LodeConfig` interface; render a
  fuller config section (source `type + source`, asset, channel, policy, pin,
  check interval, kept versions, signature policy, runtime + version) plus a
  present-but-unreadable notice; drop the state `channel` row from the lifecycle
  section (config channel now covers it — matches zzci/access).
- Update `-settings-about.test.tsx` to the `config` shape (source renders as
  `github zzci/bithk`).
- i18n `locales/{en,zh}/settings.json`: remove `about.lode.sourceManifest` and
  `about.lode.updateConfig`; add `about.lode.config`, `pin`, `checkInterval`,
  `keepVersions`, `signature`, `runtime`, `seconds`, `configUnavailable`
  (`source`/`asset`/`policy`/`channel` already present).
- `docs/changelog.md` Unreleased entry.

Out of scope: the lode SDK, `/system/lode/{restart,update,rollback,hold}`
endpoints and their audit logic, boot wiring, `deploy/lode.toml`, the supervisor
binary — all already at parity.

## Acceptance

- `GET /system/version` returns `lode.config` (not `lode.updateConfig`) with a
  `status` field and the enriched non-secret fields; the manifest host is shown
  but the manifest URL, auth headers, and trusted keys never appear in the
  response.
- The About tab's config section lists the enriched fields when `lode.toml` is
  present, and shows the "present but unreadable" notice on a malformed/unreadable
  file.
- `bun run check` passes (lint, typecheck, unit, routes, build, i18n parity,
  env-docs, api-docs, api-spec).

## Notes

- 2026-07-01 — Created from investigation of `/app/zzci/access`. `sdk.ts` is
  byte-identical between the forks (both v0.0.10); the only delta is the config
  module extraction + enriched surface + About-tab rendering. Do not implement
  before approval.
- 2026-07-01 — Approved (`开始处理`) and completed. `lode/config.ts`,
  `lode/index.ts`, and `-settings-about.tsx` are now byte-identical to
  `zzci/access`; the state `channel` row was dropped from the lifecycle section
  (faithful to the reference). Updated the two summary-shape route tests to expect
  the always-present `config` (`{ status: "not_configured" }` when `LODE_CONFIG`
  is unset). `bun run check` EXIT 0. Not committed.
