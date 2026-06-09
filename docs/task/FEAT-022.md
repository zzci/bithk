# FEAT-022 - Admin Settings About tab

- Status: Completed
- Plan: [PLAN-074](../plan/PLAN-074.md)
- Campaign: l1-s65drh22-20260609121625
- Owner: L3 yrgbzt1e
- Created: 2026-06-09

## Summary

Add an admin-only About tab to Admin Settings that shows build provenance and
safe lode-managed upgrade status without exposing sensitive deployment details.

## Acceptance Criteria

- Admin Settings includes an About tab.
- About displays app version, commit, and build time from the existing
  `BUILD_INFO` source.
- About displays safe lode active, status, and config fields when available.
- The API remains admin-only.
- No secrets, headers, trusted keys, full config contents, or sensitive
  filesystem paths are exposed.
- Missing or malformed lode data is handled gracefully.
- Upgrade controls are honest: refresh/status only unless a verified lode
  control surface exists.
- Focused API and frontend tests cover the new behavior.
- `bun run check` passes before the campaign is ready.

## Files in Scope

- `apps/api/src/modules/system/**`
- `apps/api/src/lode-state.ts`
- `apps/web/src/app/routes/_app/admin/settings.lazy.tsx`
- `apps/web/src/app/routes/_app/admin/-settings-about.tsx`
- `apps/web/src/shared/lib/api/**`
- `apps/web/src/locales/{en,zh}/settings.json`
- Focused API and frontend tests for the above

## Dependencies

- Existing admin settings page and tabs.
- Existing `GET /system/version` build-info endpoint.
- Existing lode packaging and runtime state files from [PLAN-070](../plan/PLAN-070.md)
  and [PLAN-071](../plan/PLAN-071.md).

## Status Notes

- 2026-06-09: Created and claimed for campaign tracking only. Backend and
  frontend implementation remain pending under [PLAN-074](../plan/PLAN-074.md).
- 2026-06-09: Completed after parent branch integration and L3 verification.
  `bun run check` passed with existing non-blocking lint/build warnings.
