# PLAN-098 - Port the enriched lode update-config surface from zzci/access

- Status: Completed
- Task: [FEAT-046](../task/FEAT-046.md)
- Campaign: local
- Created: 2026-07-01
- Completed: 2026-07-01

## Context

The "update system" is the lode supervisor integration. FEAT-045 / PLAN-097
(2026-06-24) rebuilt it on the vendored lode SDK (`apps/api/src/lode/sdk.ts`,
`dotns/lode@v0.0.10`) with four audited operator endpoints and a functional
About-tab UI. As part of that, it surfaced a **narrow** read-only slice of the
operator's `lode.toml` `[update]` table:

- `apps/api/src/lode/index.ts` inlines `readUpdateConfig()` returning
  `LodeUpdateConfig` = `{ policy?, channel?, asset?, sourceType?, source? }`.
  `getLodeSummary()` attaches it as the **optional** `updateConfig?` field.
  Manifest sources expose the *type* only — not even the host.
- The About tab (`-settings-about.tsx`) renders three rows (policy, source,
  asset) under an "Update configuration" section; a manifest source shows the
  literal "Manifest".

Reference — `zzci/access` (`/app/zzci/access`, same lode SDK, `sdk.ts`
byte-identical to bithk's) evolved the config surface:

- Extracts parsing into `apps/api/src/lode/config.ts`: `readLodeConfig()` returns
  `LodeConfig` with a `status`
  (`not_configured | unreadable | malformed | available`) plus `app`,
  `sourceType`, `source`, `asset`, `channel`, `policy`, `checkInterval`,
  `keepVersions`, `pin`, `requireSignature` (from `[trust]`), and `runtime` /
  `runtimeVersion` (from `[runtime]`). Manifest sources expose the **host**
  (`new URL().host`) — still never the full URL.
- `lode/index.ts` imports `readLodeConfig`/`LodeConfig` from `./config`, drops the
  inline parser, and attaches `config: LodeConfig` **always** (carrying `status`).
- `lode/config.test.ts` covers the four statuses, the github source, and the
  manifest-host redaction. `lode/index.test.ts` drops its `updateConfig` block.
- The About tab renders a fuller "Update config (lode.toml)" section (source as
  `type + source`, asset, channel, policy, pin, check interval, kept versions,
  signature policy, runtime + version) and a "present but unreadable" notice; it
  drops the state `channel` row from the lifecycle section.

bithk's `deploy/lode.toml` already carries `[trust].require_signature = "auto"`,
`[runtime]` (`bun` / `1.3.14`), and `[update].check_interval`/`keep_versions`, so
the enriched surface will render real data in production. `sdk.ts` already exports
both `configPath()` and `readConfig()`, so no SDK change is needed. The
`/system/version` route types `lode` as `z.unknown()`, so the OpenAPI spec is
unaffected.

Only importers of `@/lode` are `apps/api/src/index.ts` (boot) and
`system.routes.ts`; neither reads `updateConfig`, so the summary field rename is
internal + frontend/test-facing only.

## Approach

Port the delta faithfully (identifiers adapted to bithk), touching only the
config surface — SDK, endpoints, boot wiring, banners/history/actions stay as-is.

### Backend

1. **Add `apps/api/src/lode/config.ts`** — copy from zzci/access verbatim (it is
   generic: imports `configPath`, `readConfig` from `./sdk`; parses via
   `Bun.TOML.parse`; whitelists non-secret fields; manifest host only).
2. **Add `apps/api/src/lode/config.test.ts`** — port; adapt the github sample to
   `zzci/bithk` + `bit-linux-x64.tar.gz`, app to `bit`.
3. **`apps/api/src/lode/index.ts`**:
   - `import type { LodeConfig } from "./config"` + `import { readLodeConfig }`;
     `export type { LodeConfig, LodeConfigStatus } from "./config"`.
   - remove `readConfig` from the `./sdk` import (keep `activeVersion`,
     `isSupervised`, `Lode`, `readiness`).
   - delete `LodeUpdateConfig`, `objectRecord`, `safeConfigString`,
     `readUpdateConfig`.
   - `LodeSummary`: replace `readonly updateConfig?: LodeUpdateConfig` with
     `readonly config: LodeConfig`.
   - `getLodeSummary`: drop `const updateConfig = ...` and the
     `...(updateConfig ? { updateConfig } : {})` spread; add `config:
     readLodeConfig()`.
4. **`apps/api/src/lode/index.test.ts`**: delete the
   `getLodeSummary updateConfig (...)` describe block; drop `LODE_CONFIG` from
   `LODE_ENV` and the `beforeEach` `setEnv`.
5. **`apps/api/src/modules/system/system.routes.test.ts`**: in "surfaces safe
   update config…", assert `body.data.lode.config` `toEqual` `{ status:
   "available", sourceType: "github", source: "zzci/bithk", asset:
   "bit-linux-x64.tar.gz", channel: "stable", policy: "auto" }`; keep the
   `SECRET` / `trusted-key-material` redaction assertions.

### Frontend

6. **`-settings-about.tsx`**:
   - `LodeStatus.updateConfig?: LodeUpdateConfig` → `config?: LodeConfig`.
   - replace the `LodeUpdateConfig` interface with the richer `LodeConfig`
     (`status`, `app`, `sourceType`, `source`, `asset`, `channel`, `policy`,
     `checkInterval`, `keepVersions`, `pin`, `requireSignature`, `runtime`,
     `runtimeVersion`, all nullable).
   - remove the state `channel` row from `rows` (lifecycle).
   - replace `uc`/`updateRows`/source-ternary with `cfg`/`configRows` +
     `configProblem`; render the config section (with the unreadable notice)
     exactly as zzci/access.
7. **`-settings-about.test.tsx`**: rename mock `updateConfig` → `config` (+
   `status: "available"`); change `getByText("zzci/bithk")` →
   `getByText("github zzci/bithk")`.
8. **i18n** `locales/en/settings.json` + `locales/zh/settings.json` under
   `about.lode`:
   - remove `sourceManifest`, `updateConfig`.
   - add `config`, `pin`, `checkInterval`, `keepVersions`, `signature`,
     `runtime`, `seconds`, `configUnavailable`.
   - en: `config`="Update config (lode.toml)", `pin`="Pinned version",
     `checkInterval`="Check interval", `keepVersions`="Kept versions",
     `signature`="Signature policy", `runtime`="Runtime", `seconds`="{{n}}s",
     `configUnavailable`="lode.toml is present but could not be read."
   - zh: `config`="更新配置（lode.toml）", `pin`="锁定版本",
     `checkInterval`="检查间隔", `keepVersions`="保留版本数",
     `signature`="签名策略", `runtime`="运行时", `seconds`="{{n}} 秒",
     `configUnavailable`="lode.toml 存在但无法读取。"

### Docs

9. `docs/changelog.md` Unreleased "Changed" entry. Mark FEAT-046 / PLAN-098 done.

## Verification

- `bun run check` (lint, typecheck, unit, `check:routes`, build, `check:i18n`
  parity + unused, `check:env-docs`, `check:api-docs`, `check:api-spec`) → EXIT 0.
- Targeted: `bun test apps/api/src/lode` and the system routes + about tests pass.

## Risks

- **Lifecycle `channel` row removed.** Faithful to zzci/access; the state channel
  is dropped from the lifecycle rows (config channel from `lode.toml` remains).
  Low impact — the channel is still shown when `lode.toml` is present. Reversible
  by keeping the row if undesired.
- **`check:i18n` unused/parity gate.** Removing `sourceManifest`/`updateConfig`
  and adding the new keys must be mirrored in both en and zh, or the gate fails.
- **Response shape change** (`updateConfig` → `config`). No API consumer reads the
  old field except the two tests (updated here); the OpenAPI schema is
  `z.unknown()`, so no spec churn.

## Alternatives

- **Minimal (enrich in place):** widen the inline `readUpdateConfig()` without a
  separate module. Rejected — the user asked to port zzci/access's shape, and the
  dedicated module + `status` field is the point of the port.
- **Keep `updateConfig` name, only enrich fields.** Rejected — diverges from the
  reference for no benefit.
