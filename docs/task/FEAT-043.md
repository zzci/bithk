# FEAT-043 - Editable built-in Default group for ungrouped users

- Status: Completed
- Plan: [PLAN-095](../plan/PLAN-095.md)
- Campaign: local
- Owner: session
- Created: 2026-06-20

## Summary

Surface the implicit "ungrouped user" visibility floor as a first-class,
editable built-in **Default** group on the admin Groups page, alongside the
existing built-in **Administrators** entry.

Today a non-admin user who belongs to no module-granting group sees nothing
(`resolveUserModules` returns `[]` — the visibility floor). That floor is
invisible and not configurable. This task makes it a visible, named built-in
**Default** entry whose module grants admins can edit.

Semantics are **fallback, not additive**: the Default group's modules apply
only to users in **no** group. A user placed in any group (even a zero-module
one) leaves Default and sees only their groups' union — so an admin can tighten
a specific user below the default by assigning them to a restrictive group.

## Acceptance Criteria

- **Backend resolution.** `resolveUserModules` (account/groups/module-gate.ts):
  - admin → all module keys (unchanged);
  - non-admin in **no** group → the Default group's modules (was `return []`);
  - non-admin **with** groups → union of their groups' modules only (Default is
    **not** unioned in).
  - Default modules stored in settings under `account.default_modules` (JSON
    string array). Unset/empty resolves to `[]`, exactly matching today's
    behavior (no regression).
- **Backend API.** New admin-only endpoints on the groups router:
  - `GET /account/groups/default` → `{ modules: ModuleKey[] }`.
  - `PATCH /account/groups/default` `{ modules: string[] }` → validates keys
    against `MODULE_KEYS` (422 on unknown), persists in registry order, audits,
    returns `{ modules }`. Registered before `/account/groups/:id` so `default`
    is not parsed as an id.
- **Frontend.** The Groups tab shows a built-in **Default** entry under
  Administrators: "System" badge, module-grants summary, an edit affordance that
  opens a modules-only switch dialog (no name/description), no delete. Selecting
  it shows a member-panel note ("applies to all users not in any group"); no
  member add/remove. The Administrators entry and custom-group flows are
  unchanged.
- en/zh i18n for the Default entry strings.
- Focused tests: `module-gate.test.ts` (fallback resolution), `groups.test.ts`
  (get/set default modules service), `groups.routes.test.ts` (GET/PATCH + 422),
  web `-groups-page.test.tsx` (Default entry render + edit PATCH). `bun run
  check` passes (incl. regenerated api-docs/api-spec).

## Files in Scope

- `apps/api/src/modules/account/groups/module-gate.ts` (default resolution),
  `groups.service.ts` (set helper), `groups.routes.ts` (GET/PATCH default),
  `module-gate.test.ts`, `groups.test.ts`, `groups.routes.test.ts`
- `apps/web/src/app/routes/_app/admin/users/groups.lazy.tsx` (Default entry +
  modules dialog), `-groups-page.test.tsx`
- `apps/web/src/locales/{en,zh}/groups.json`
- `skills/bithk/references/api-spec.json` + generated api-docs (regenerated)
- `docs/changelog.md`

## Dependencies

- Builds on [FEAT-032](FEAT-032.md) / [PLAN-081](../plan/PLAN-081.md) (groups
  absorb global roles) and the PLAN-076 module-visibility gate. Reuses the
  settings module for storage. **No DB migration** (settings-backed).

## Status Notes

- 2026-06-20: Created with [PLAN-095](../plan/PLAN-095.md). Approved ("开始处理");
  implementation started. Decisions: name **Default** (not Guest, to avoid
  semantic confusion); **fallback** semantics (not additive) so admins can
  restrict a user by group assignment; modules-only edit (name locked, no
  delete); settings-backed (`account.default_modules`). IDs FEAT-042/PLAN-094
  were already taken by a concurrent currency task.
- 2026-06-20: Completed. Backend: `module-gate.ts` adds
  `DEFAULT_MODULES_SETTING_KEY` + `resolveDefaultModules`, and
  `resolveUserModules` now returns the Default group's modules for ungrouped
  non-admins (was `[]`); grouped users are unchanged (Default not unioned).
  `groups.service.setDefaultModules` validates + persists registry-ordered;
  `groups.routes` adds admin `GET`/`PATCH /account/groups/default` (registered
  before `/:id`, audited `group.default_updated`). Web: built-in **Default**
  entry on the Groups tab with a modules-only dialog (shared `ModuleSwitchTable`
  extracted, reused by the group form), member panel note, no delete; en/zh
  i18n `default.*`. Tests: module-gate fallback (ungrouped gets default, grouped
  does not), service get/set, routes GET/PATCH/422/403, web render + edit PATCH.
  Regenerated api-routes.md (313) + api-spec.json (200). `bun run check` EXIT 0.
  Not committed/pushed. Default stays empty → no behavior change until an admin
  edits it. Pre-existing unrelated dirty files (concurrent currency/procurement
  work) left untouched.
