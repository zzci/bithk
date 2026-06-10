# PLAN-074 - Admin Settings About tab

- Status: Completed
- Task: [FEAT-022](../task/FEAT-022.md)
- Campaign: l1-s65drh22-20260609121625
- Created: 2026-06-09

## Context

Admin Settings currently has Auth, SMTP, Webhook, Project Defaults, Contact, and
Ship tabs. It does not expose a user-facing system About surface.

The API already has `GET /system/version`, guarded by `authRequired` and
`adminRequired`, returning `BUILD_INFO` with version, commit, and build time.
The lode integration currently writes readiness to `${LODE_DATA_DIR}/state.json`
through `apps/api/src/lode-state.ts`; `deploy/lode.toml` contains update policy
and trust configuration, but there is no verified app-owned lode upgrade control
API in this repository.

## Proposal

1. Add a narrow admin-only system About/status API.
   - Reuse `BUILD_INFO` for version, commit, and build time.
   - Report whether lode appears active from safe runtime signals such as
     `LODE_DATA_DIR` and `LODE_INSTANCE`.
   - Read only safe status fields from lode state when available.
   - If lode config is read, expose only non-sensitive fields such as update
     source type, asset, channel, policy, interval, keep count, readiness mode,
     and signature enforcement mode.
   - Redact or omit secrets, headers, trusted keys, full config contents, raw
     filesystem paths, and unknown sensitive fields.
   - Treat missing, unreadable, or malformed lode files as non-fatal status
     states.

2. Add the About tab in Admin Settings.
   - Add an About tab trigger and tab content using existing settings-page
     patterns.
   - Display build information and lode status in compact read-only sections.
   - Show refresh/status controls only.
   - Do not add restart, install, rollback, or upgrade buttons unless a later
     implementation verifies a supported lode control surface.

3. Add focused tests.
   - API tests for admin-only access, build info, safe lode status, redaction,
     and malformed or missing lode data.
   - Frontend tests for the About tab, loading/error/empty states, displayed
     build fields, lode status rendering, and refresh behavior.
   - Run `bun run check` before marking the campaign ready.

## Risks

- Lode state/config shape may change; parsing must be defensive and avoid
  treating unknown fields as display-safe.
- Exposing lode paths, trust keys, request headers, or raw config would leak
  operational details.
- Upgrade actions would be misleading without a verified lode control API, so
  this plan limits controls to status and refresh.

## Scope

Expected implementation touches the system API, lode status helper code, Admin
Settings UI, localized settings strings, and focused tests. No database schema
change or dependency addition is planned.

## Alternatives

- Use only the existing `/system/version` endpoint: too narrow because it cannot
  describe lode-managed runtime status.
- Expose raw lode `state.json` and `lode.toml`: rejected because raw files may
  contain paths or sensitive operational configuration.
- Add upgrade/restart controls immediately: rejected until a supported lode
  control surface is verified.

## Annotations

- 2026-06-09: Created and marked implementing for campaign tracking. Source
  implementation is intentionally not included in this tracking-only issue.
- 2026-06-09: Completed. Verified the merged backend and frontend scope,
  including admin-only `/system/version`, sanitized lode summary fields,
  graceful missing/malformed lode state handling, About tab rendering, refresh
  behavior, and omitted manual upgrade controls. `bun run check` passed.
