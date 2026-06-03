# PLAN-063 Project role editor: in-page dropdown + table (replace modal)

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 zvko353r
- **campaignId**: l1-75ymcfnr-roleui-20260603194819
- **tasks**: [UI-023](../task/UI-023.md)
- **createdAt**: 2026-06-03

## Goal

Replace the project role create/edit modal (`RoleDialog`) with an IN-PAGE
editor inside the Roles settings tab. The Roles tab already renders inside
`ProjectSettingsDialog` (a modal), so `RoleDialog` is a modal-within-a-modal —
the "too many nested dialogs is unfriendly" complaint. The capability semantics
(tiers + admin caps + presets) stay identical; only the modal shell becomes
in-page.

## Current state

- `apps/web/src/app/routes/_app/projects/-project-settings-roles.tsx`
  - `ProjectSettingsRoles` (lines ~141-252): lists roles as cards; "Add role"
    button opens `RoleDialog` in create mode; per-row Edit/Delete buttons open
    `RoleDialog` edit / `ConfirmDeleteDialog`.
  - `RoleDialog` (lines ~254-441): modal `Dialog` with name input, preset
    buttons, three per-module tier `RadioGroup`s (issue/procurement/files),
    admin-cap `Switch`es, footer Save/Cancel.
  - Tier helpers `ISSUE_TIERS`/`PROCUREMENT_TIERS`/`FILES_TIERS`,
    `deriveIssueTier`/`deriveProcurementTier`/`deriveFilesTier`,
    `buildCapabilities`, presets `PRESET_READER/COMMENTER/WRITER`,
    `systemRoleLabel`, `ADMIN_CAPS` — all reused unchanged.
  - Hooks `useProjectRoles`/`useCreateProjectRole`/`useUpdateProjectRole`/
    `useDeleteProjectRole` from `@/shared/lib/api/projects` — reused unchanged.
- Mounted at `-project-settings-dialog.tsx:218-219`
  (`<ProjectSettingsRoles projectId canManage />`) inside a `Dialog`. Props
  unchanged → no wiring change needed.
- i18n: `locales/{en,zh}/projects.json` `roles.*`, `capabilityGroup.*`,
  `capability.*`, `toast.role*` already cover the controls. Add only new inline
  labels if the in-page layout needs them (e.g. a role-selector label / table
  column headers), with en/zh parity.
- Test: `-project-settings-roles.test.tsx` exists; must be updated for the
  in-page editor (no modal open/close; dropdown selection drives the editor).

## Scope / Constraints

- Edit ONLY `-project-settings-roles.tsx` and its test
  `-project-settings-roles.test.tsx`. A concurrent campaign edits the sibling
  `-project-settings-members.tsx` (member RoleSelect) — DIFFERENT file, no
  overlap; keep changes localized.
- May touch `-project-settings-dialog.tsx` only for minimal wiring IF strictly
  necessary (not expected — props are unchanged).
- Reuse the existing tier/derive/build helpers and the existing mutation hooks
  verbatim; do NOT change capability semantics.
- Keep `ConfirmDeleteDialog` for delete (a confirm is acceptable). Only the
  create/EDIT modal becomes in-page. Remove the now-unused `RoleDialog` modal
  scaffolding and any imports it alone used (`Dialog*`, etc.) once dead.
- System roles (Owner/Guest) stay read-only: shown but not editable/deletable;
  display their caps read-only. Custom/preset roles editable.
- i18n en/zh parity; reuse keys, add only if a new inline label is required.
- Dev phase: breaking changes OK.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown/ctx
  teardown flake (exit1 with 0 real test failures).

## Target design (in-page)

- A **role selector** (`Select` dropdown) at the top listing a "+ New role"
  option plus every role (system + custom). Selecting a role loads it inline
  into the editor below (no modal). A custom role → edit mode; "+ New role" →
  create mode; a system role → read-only view.
- A **permissions table** rendered inline: rows = capability modules
  (Issue / Procurement / Files tier controls) + the Administration caps, cells =
  the existing tier control (radio/select) and admin `Switch`es. Reuse
  `buildCapabilities` / the derive helpers to map between caps[] and the
  controls.
- Inline **Name** input + **Save** / **Delete** actions. Save uses the same
  create/update hooks; Delete keeps `ConfirmDeleteDialog`. System roles render
  the table read-only with no Save/Delete.
- Behavior parity: create + update + delete identical to today (same hooks,
  same toasts, same validation/`name.trim()` guard, same preset quick-fill).

## Acceptance Criteria

- Role create/edit happens IN-PAGE in the Roles tab — no nested `Dialog` for
  create/edit. `RoleDialog` removed; no dead imports left.
- A dropdown selects which role to edit + a "+ New role" entry; selection loads
  the editor inline.
- Permissions are set via an inline TABLE (module rows + tier/admin controls),
  reusing `buildCapabilities`/`derive*Tier`.
- Create / update / delete behave identically (same hooks, toasts, validation);
  `ConfirmDeleteDialog` retained for delete.
- Owner/Guest system roles are read-only (caps shown, not editable/deletable);
  presets/custom roles editable.
- i18n en/zh parity (reused keys; any new key present in both locales).
- `-project-settings-roles.test.tsx` updated for the in-page flow and passes.
- `bun run check` EXIT=0 (modulo the @milkdown flake).

## Decomposition (1 L3)

1. **L3-1 in-page role editor** — rewrite `-project-settings-roles.tsx`:
   replace `RoleDialog` modal with the in-page dropdown + permissions table
   editor (reusing all tier/derive/build helpers + mutation hooks), keep
   `ConfirmDeleteDialog`, enforce system-role read-only, update i18n if a new
   inline label is needed (en+zh), and update
   `-project-settings-roles.test.tsx`. Run `bun run check`.
