# REFACTOR-001 — Drop the `portal` segment from frontend routing

- **Status:** Done
- **Plan:** [PLAN-006](../plan/PLAN-006.md)
- **Created:** 2026-05-23
- **Owner:** roy

## Scope

The `_app/portal/*` grouping prefix carries no meaning. Flatten it so regular
modules mount at the root and the dashboard gets a named route:

- portal home `/portal` → `/overview` (`_app/overview.{tsx,lazy.tsx}`)
- `/portal/drive` → `/drive`, `/portal/documents` → `/documents`,
  `/portal/issues` → `/issues`, `/portal/projects` → `/projects`
- `/admin/*` unchanged
- Root `/` redirect (`routes/index.tsx`) unchanged
- Default landing `${BASE_PATH}/portal` → `${BASE_PATH}/overview`
  (login, totp, backend OIDC `auth.routes.ts`)
- `drive.permission.ts` share URL `/portal/drive` → `/drive`
- Nav paths + `isNavActive` special-case updated; route tree regenerated

Per follow-up ("全部修改"), the rename was extended beyond routing to remove
the `portal` concept entirely: `NavArea` `portal` → `overview`, nav key/label,
the `portal` i18n namespace (`portal.json` → `overview.json`),
`denied.backToPortal` → `backToOverview`, and the `shared/components/portal/`
document-tree utils directory → `shared/components/documents/`.

Out of scope: React DOM portals (`createPortal`, `*.Portal`) — unrelated UI
primitives, untouched.

## Verification

- `bun run typecheck` and `bun run lint` clean in `apps/web`
  (pre-existing web coverage-gate failure on main is not a regression).
- App builds; route tree regenerates with no `portal` segment.
- Navigation, login landing, and drive share links resolve to the new paths.
