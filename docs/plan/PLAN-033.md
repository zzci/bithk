# PLAN-033: Present the project owner role and simplify role settings

- Status: Done
- Task: UI-020
- Created: 2026-05-28

## Summary

Present the highest, system, full-capability project role as "Project Owner" and
hide its capability badge list in role settings, while keeping authorization
semantics and custom-role management unchanged.

## Current State

- `seedDefaultRoles` seeds an `isSystem` role named "Project Manager" locked to
  the full `PROJECT_CAPABILITIES` set, plus a non-system "Member" role.
- `-project-settings-roles.tsx` renders `role.name`, a `roles.system` badge, and
  a flex-wrap list of capability badges for every role (including the system one).
- `-project-settings-members.tsx` shows `role.name` in the role selector and the
  read-only role badge.

## Approach

- Rename the seed source string from "Project Manager" to "Project Owner" in
  `project.roles.ts` (and aligned comments in `schema.ts` / `project.service.ts`).
  The migration baseline is regenerated from code by CHORE-002 / PLAN-030, so no
  migration is hand-authored.
- In role settings, display the system role name via `t("roles.owner")` and omit
  the capability badge block entirely for system roles. Custom roles keep their
  capability badges and full management controls.
- In members settings, present the system role as "Project Owner" in both the
  role selector and the read-only badge via a small display-name mapping.
- Add the `roles.owner` key to en/zh project locales.

## Risks

- Backend tests and helpers reference the literal "Project Manager" role name;
  these are updated to "Project Owner".
- Authorization is unaffected: only the display name and seed source string
  change; `isSystem`, capability lock, and undeletability are untouched.

## Verification

- Frontend: `bunx vitest run` on the roles and members settings tests.
- Backend: `bun test` on the project/ship/issue/drive tests that reference the
  seeded role name.
