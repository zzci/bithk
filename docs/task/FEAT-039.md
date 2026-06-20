# FEAT-039 Drive sidebar Projects entry: browse files of accessible projects

- Status: Completed
- Plan: [PLAN-091](../plan/PLAN-091.md)
- Owner: local-session
- Updated: 2026-06-19

## Goal

Let users browse a project's files from the drive. The drive sidebar already
lists fixed views, shared views, and the user's team directories inline; add a
"Projects" section that lists every project the current user can access and,
when one is selected, opens its file browser in the main pane.

## Scope

Frontend only — the backend already supports project-scoped drive entries
(`ownerType=project`, `ownerId=<project shortId>`) for list/search/create/upload
with `files.view` / `files.manage` capability checks, and `GET /projects`
already returns exactly the projects the caller can access (non-admins are
membership-filtered server-side).

- `-drive-sidebar.tsx`: add a "Projects" section after the Team section that
  lists `useProjects()` results as clickable rows (read-only list, no create /
  manage menu — projects are not created from the drive). New props
  `activeProjectId` / `onSelectProject`.
- `drive.lazy.tsx`: add `activeProject` state, mutually exclusive with
  `activeView` and `activeTeamDir`; render `FileBrowser` with
  `ownerType="project"`, `ownerId={project.id}` when a project is active.
  `canManage` is derived from the project's `files.manage` capability
  (fetched via the project detail hook).
- i18n: `sidebar.section.projects` + `sidebar.projectsEmpty` in en + zh.

## Acceptance

- The drive sidebar shows a "Projects" section listing the projects the user can
  access; an empty state shows when there are none.
- Selecting a project opens its file browser (folders/files, navigation,
  download, search) scoped to that project.
- A user with `files.manage` on the project sees create/upload/rename/move/trash
  affordances; a viewer-only member sees a read-only browser.
- `bun run check` EXIT 0.

## Notes

- 2026-06-19 — Implemented frontend-only across `-drive-sidebar.tsx` (Projects
  section listing `useProjects()`), `drive.lazy.tsx` (`activeProject` state +
  `ProjectFileBrowser` wrapper deriving `canManage` from the project's
  `files.manage` capability), and `locales/{en,zh}/drive.json`. No backend
  changes — the existing `FileBrowser` + `ownerType="project"` path was reused.
- Verification: lint EXIT 0 (0 errors), typecheck OK, web tests 856 pass / api
  tests 1890 + 533 pass, web build EXIT 0, check:i18n in sync, check:api-docs up
  to date. The two changed `.tsx` files are individually eslint-clean.
- Caveat: a concurrent process was actively editing unrelated API files in this
  shared worktree during implementation (`procurement.routes.ts` / `schema.ts` /
  its test, `shared/lib/client-ip.ts`, plus FEAT-040 / PLAN-092). Those edits
  make the committed `skills/bithk/references/api-spec.json` stale, so the
  aggregate `bun run check` reports `check:api-spec` red. The drift is entirely
  procurement-scoped (the regenerated spec diff touches procurement, never
  drive/projects) and is not caused by this task. Left untouched for the owning
  process to regenerate and commit.
