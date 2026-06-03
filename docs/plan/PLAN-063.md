# PLAN-063 Fix duplicate 项目所有者 in member role select

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 lv35gmya
- **campaignId**: l1-75ymcfnr-roledup-20260603194527
- **tasks**: [FIX-037](../task/FIX-037.md)
- **createdAt**: 2026-06-03

## Goal

The project members "角色" (role) select shows TWO "项目所有者" (Project Owner)
entries. The member settings file labels every system role as the owner, so the
two system roles — Owner (`kind="owner"`) and Guest (`kind="guest"`) — both
render as "项目所有者". Fix the labelling to switch on `role.kind` (matching the
roles settings page) and drop the Guest role from the assignable dropdown.

## Current state

- `apps/web/src/app/routes/_app/projects/-project-settings-members.tsx`
  - `roleNames` map (~line 76): `role.isSystem ? t("roles.owner") : role.name` —
    labels EVERY system role as owner.
  - `RoleSelect.roleLabel` (~line 415): same `isSystem ? owner : name` bug; both
    SelectItem options and the trigger value use it, so Owner + Guest both show
    "项目所有者".
- `apps/web/src/app/routes/_app/projects/-project-settings-roles.tsx:128-134` —
  `systemRoleLabel(role, ownerLabel, guestLabel)` already resolves the label
  correctly by `role.kind` (guest → guest, owner/legacy → owner). This is the
  pattern to reuse.
- `apps/web/src/shared/lib/api/projects.ts:80` — `ProjectRoleView.kind?:
  "owner" | "guest" | null`.
- i18n keys already exist in both locales: `roles.owner`
  (`locales/{en,zh}/projects.json:292`) and `roles.guest` (`:293`). No new keys
  needed.
- `apps/web/src/app/routes/_app/projects/-project-settings-members.test.tsx`
  fixtures: `roles=[{id:"r1",name:"Owner",isSystem:true}, {id:"r2",name:"Worker",
  isSystem:false}]` (no `kind`). Legacy system role with no kind → owner, so the
  existing "Project Owner" assertion still holds after the fix.

## Scope / Constraints

- In: `apps/web/src/app/routes/_app/projects/-project-settings-members.tsx`
  + its test. Reuse `systemRoleLabel`: extract it into the shared
  `apps/web/src/app/routes/_app/projects/-member-helpers.ts` module and import
  it in both `-project-settings-members.tsx` and `-project-settings-roles.tsx`
  (single source of truth, no duplication). Touching `-member-helpers.ts` and
  the one import line in `-project-settings-roles.tsx` is permitted as part of
  the de-duplication.
- Out: the Reader/Commenter/Writer preset roles render their stored English
  names (no i18n) — SEPARATE pre-existing gap, only flag it, do not fix here.
  Backend, other settings tabs, other locales untouched.
- Dev phase: breaking changes OK.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known `@milkdown/ctx`
  teardown flake (exit1 with 0 real test failures).

## Acceptance Criteria

- Role labels switch on `role.kind`: `kind==="guest"` → `t("roles.guest")`;
  `kind==="owner"` or legacy system role with no kind → `t("roles.owner")`;
  non-system → `role.name`. Applied to BOTH `roleNames` (~76) and
  `RoleSelect.roleLabel` (~415).
- The assignable RoleSelect dropdown EXCLUDES `kind==="guest"` options. It shows
  项目所有者 (once), Reader, Commenter, Writer — no duplicate, no Guest option.
- A member already assigned the Guest role still DISPLAYS as 访客 / Guest in the
  member table via the fixed label.
- `systemRoleLabel` has a single definition shared by both files (no copy).
- en/zh i18n parity preserved (`roles.guest` present in both — verify).
- `-project-settings-members.test.tsx` updated: assert Guest system role renders
  as "Guest" in the table and is absent from the assignable dropdown options;
  existing assertions still pass.
- `bun run check` EXIT=0 (modulo the `@milkdown` flake).

## Decomposition (1 L3)

1. **L3-1 members role-label + guest exclusion** — extract `systemRoleLabel`
   into `-member-helpers.ts`; import it in `-project-settings-roles.tsx`
   (replace local copy) and `-project-settings-members.tsx`; apply it to both
   `roleNames` and `RoleSelect.roleLabel`; filter `kind==="guest"` out of the
   assignable RoleSelect options; update the test. Run `bun run check`.
