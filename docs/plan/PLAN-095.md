# PLAN-095 Editable built-in Default group for ungrouped users

- **status**: completed
- **createdAt**: 2026-06-20 00:00
- **approvedAt**: 2026-06-20 00:00
- **relatedTask**: FEAT-043

## Context

Module visibility (PLAN-076, group-based since FEAT-032) is resolved by
`resolveUserModules` (`apps/api/src/modules/account/groups/module-gate.ts:79`):

- admin → every `MODULE_KEYS`;
- otherwise the UNION of the modules granted by the user's groups;
- a user in **no** module-granting group → `return []` (the visibility floor).

`resolveUserModules` feeds both the module gate (404-conceals ungranted module
routes) and `GET /account/me.modules` (the web shell derives nav from it).
There is exactly one synthetic built-in concept in the UI today —
**Administrators** (`__admins__` sentinel in `groups.lazy.tsx`, backed by
`users.role`, no DB row). The "ungrouped → nothing" floor is real behavior but
is invisible and not editable.

The settings module (`apps/api/src/modules/settings`) is a generic key/value
store: `getSetting(db, key)` / `setSetting(db, key, value, { updatedBy })`.
Group module lists are JSON string arrays validated against `MODULE_KEYS`
(`assertValidModules` in `groups.service.ts`).

## Proposal

Make the floor a first-class, editable built-in **Default** group. Treat it as
a **fallback** (applies only to users in no group), not an additive baseline —
so an admin can tighten a specific user *below* the default by putting them in a
restrictive group. Store the Default group's modules in settings; no DB
migration, no new table.

### Backend

1. **`module-gate.ts`** — add:
   - `export const DEFAULT_MODULES_SETTING_KEY = "account.default_modules";`
   - `export async function resolveDefaultModules(db): Promise<ModuleKey[]>` —
     read the setting, `parseModules`, return in registry order; unset → `[]`.
   - In `resolveUserModules`, change the `groupIds.length === 0` branch from
     `return []` to `return resolveDefaultModules(db)`. The grouped-user union
     path is unchanged (Default is **not** added to it).
2. **`groups.service.ts`** — `export async function setDefaultModules(db,
   modules, updatedBy): Promise<ModuleKey[]>`: `assertValidModules`, persist
   `JSON.stringify(MODULE_KEYS.filter(k => modules.includes(k)))` via
   `setSetting`, return the ordered list. (Reuses `resolveDefaultModules` for
   reads.)
3. **`groups.routes.ts`** — register **before** `/account/groups/:id` (so
   `default` is not matched as `:id`):
   - `GET /account/groups/default` (adminRequired) → `{ modules }` from
     `resolveDefaultModules`.
   - `PATCH /account/groups/default` (adminRequired, `validator("json",
     { modules: z.array(z.string()) })`) → `setDefaultModules`, audit
     (`group.default_updated`), return `{ modules }`. Unknown keys → 422 via the
     service's `ValidationError`.

### Frontend (`groups.lazy.tsx` + i18n)

- Add a `DEFAULT = "__default__"` sentinel and `defaultModules` state; fetch
  `GET /account/groups/default` on mount.
- Render a built-in **Default** entry directly under Administrators: "System"
  badge, the module-grants summary line (same renderer as custom groups), an
  edit (pencil) button with a **distinct** aria-label (`default.edit`, so the
  existing `{ name: "Edit" }` group-edit test stays unambiguous), **no** delete.
- The edit dialog is modules-only (no name/description). Extract the existing
  module switch `<Table>` into a small `ModuleSwitchTable` used by both the
  Default dialog and `GroupFormDialog` (real reuse, not gratuitous). On save:
  `PATCH /account/groups/default { modules }`, refetch.
- Selecting Default: member panel shows a note (`default.membersDescription`,
  "applies to all users not in any group"); no add button, no member list, no
  count badge.
- i18n `groups.json` (en/zh): `default.{name,description,edit,editTitle,
  editDescription,membersDescription}`.

### Tests + generated artifacts

- `module-gate.test.ts`: ungrouped user resolves to the configured default
  modules; a user in a (even grant-less) group does **not** inherit them; keep
  the "empty when unset" case.
- `groups.test.ts`: `setDefaultModules` persists + orders; unknown key throws.
- `groups.routes.test.ts`: GET default (empty + after set), PATCH sets, PATCH
  unknown key → 422, non-admin → 403.
- `-groups-page.test.tsx`: mock `GET /account/groups/default`; assert the
  Default entry renders and its edit dialog PATCHes `/account/groups/default`.
- Regenerate api-docs + api-spec.

## Risks

- **Security/visibility.** Raising the default from empty grants those modules
  to *every* ungrouped non-admin (incl. guest-like accounts). This is the
  feature intent; the default stays `[]` until an admin edits it (no silent
  change, no regression to existing zero-module-floor tests/e2e e.g. FIX-044).
- **Route ordering.** `/account/groups/default` must precede `:id`; covered by a
  routes test (GET returns `{ modules }`, not a 404 "Group default").
- **Test mock collision.** The web test's generic `GET /api/account/groups`
  branch would otherwise swallow `/default`; add a `/default` branch before it.
- **Fallback semantics are intentional**: grouped users do not inherit Default.
  An admin who wants a *universal* baseline must instead use an "All Staff"-style
  group (as the seed already does). Documented in the Default entry copy.

## Scope

3 backend files + 3 backend test files; 1 web component + 1 web test; 2 i18n
files; regenerated api-docs/spec; changelog. No migration.

## Alternatives

- **Real `groups` row with an `is_default` flag** — rejected: needs a migration,
  a single-default invariant, a boot backfill, and delete/member guards, and
  member-count semantics ("all users") don't map to membership tuples. The
  settings-backed synthetic entry mirrors the existing Administrators pattern
  with far less surface.
- **Additive baseline (Default unioned for everyone)** — rejected by the user:
  it makes it impossible to restrict a user below the default; fallback
  semantics let group assignment tighten access.
- **Reuse the generic `/settings/:key` endpoint from the web** — rejected:
  module-key validation belongs in the groups domain; a dedicated endpoint keeps
  the Groups UI cohesive and validates with `assertValidModules`.

## Annotations

- 2026-06-20: Proposal iterated with the user. Decisions locked: name
  **Default** (not Guest); **fallback** (not additive) semantics so a user can
  be restricted via group assignment; modules-only edit, name locked, no delete;
  settings-backed (`account.default_modules`), no migration. Approved with
  "开始处理". IDs shifted to FEAT-043/PLAN-095 (FEAT-042/PLAN-094 taken by a
  concurrent currency task).
