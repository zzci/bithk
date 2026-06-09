# PLAN-072 - Runtime branding from server settings

- Status: Completed
- Task: [FIX-039](../task/FIX-039.md)
- Campaign: local
- Created: 2026-06-09

## Problem

The frontend imports `APP_DISPLAY_NAME` from `import.meta.env`, which Vite
replaces during the web build. After packaging, changing runtime environment or
settings cannot update the login title, app shell brand labels, or
`document.title`.

The existing generic `/settings` routes are admin-only and can contain
sensitive keys, so they are not suitable for the login page. The existing
`/system/*` module is already mounted in public routing and each endpoint
controls its own auth requirements.

## Proposal

1. Add a public `GET /system/branding` endpoint.
   - Return only non-sensitive branding data, initially `appDisplayName`.
   - Resolve from a settings key such as `app.display_name`, with
     `config.APP_DISPLAY_NAME` as fallback.
   - Keep the generic `/settings` routes admin-only.

2. Seed and document the runtime setting.
   - Seed `app.display_name` from `APP_DISPLAY_NAME` when missing, matching the
     existing `session.max_age` settings seed pattern.
   - Update environment reference wording to make clear the env var is the
     server fallback and initial seed, not the final frontend runtime source.

3. Add a small frontend branding data layer.
   - Keep `APP_NAME` build-time for storage namespace stability.
   - Keep build-time `APP_DISPLAY_NAME` only as an initial/failure fallback.
   - Provide a `useBranding` hook backed by TanStack Query or an equivalent
     shared store.

4. Replace visible display-name call sites.
   - `document.title`
   - login page heading
   - authenticated app mobile header
   - sidebar header
   - SMTP from-name placeholder

5. Verify with focused tests and the full gate.
   - API route test for unauthenticated branding and settings override.
   - Frontend tests for title/label fallback and runtime override.
   - `bun run check`

## Risks

- Initial `index.html` title remains the build-time fallback until the SPA
  loads. Runtime HTML template replacement would be a separate, more invasive
  server-side change.
- Making all settings public would be unsafe; the endpoint must remain narrow.
- Changing `APP_NAME` at runtime would change localStorage keys and could make
  users lose theme/language/sidebar state, so this plan deliberately keeps it
  static.

## Annotations

- 2026-06-09: Proposed after investigating frontend build-time branding and
  API settings/system route boundaries.
- 2026-06-09: Completed with `/api/system/branding`, `app.display_name`
  settings fallback/seed behavior, frontend runtime branding reads, focused
  tests, `bun run check`, and `bun run package`.
