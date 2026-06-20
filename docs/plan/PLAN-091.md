# PLAN-091 Drive sidebar Projects entry: browse files of accessible projects

- status: Completed
- createdAt: 2026-06-19
- approvedAt: 2026-06-19
- relatedTask: FEAT-039

## Context

The drive page (`drive.lazy.tsx` + `-drive-sidebar.tsx`) renders a left view-nav
sidebar with two fixed sections (Files, Shared) plus an inline Team section that
lists the user's team directories; selecting a team directory swaps the main
pane to the shared `FileBrowser` surface scoped to that directory
(`ownerType="team_directory"`).

The backend already models project files identically:

- `drive_entries.owner_type` includes `"project"`; the shared `FileBrowser`
  already accepts `ownerType="project"` (it just forwards `ownerType` / `ownerId`
  to the drive hooks).
- `GET /drive/entries` (and search/create/upload) resolve a project `shortId` to
  the internal ULID via `resolveProjectOwnerId` and enforce membership +
  `files.view` (list) / `files.manage` (write); app admins bypass.
- `GET /projects` (`useProjects`) returns exactly the projects the caller can
  access — non-admins are filtered to their memberships server-side. The list
  `ProjectView.id` IS the project shortId (the sole external identifier), which
  is the value `FileBrowser` must pass as `ownerId` for `ownerType="project"`.

So this is a pure frontend wiring task: surface accessible projects in the drive
sidebar and route a selection into the existing browser surface.

## Goal

Add a "Projects" entry to the drive sidebar that lists the projects the current
user can access and opens each project's file browser in the drive main pane,
reusing the existing `FileBrowser` surface with no backend changes.

## Proposal

- **Sidebar list** (`-drive-sidebar.tsx`): add a "Projects" section rendered
  after the Team section. It calls `useProjects()` and renders each project as a
  ghost-button row (the existing `NAV_ITEM_CLASS` style) with the `Layers` icon
  (matching the projects module nav) and the project name; clicking calls
  `onSelectProject(project)`. Shows a muted empty line (`sidebar.projectsEmpty`)
  when the list is empty. Unlike Team, it carries no create / per-row management
  menu — projects are managed from the projects module, not the drive.
  New props: `activeProjectId: string | null`, `onSelectProject: (project) => void`.
- **Page state** (`drive.lazy.tsx`): add `activeProject: ProjectView | null`,
  mutually exclusive with `activeView` / `activeTeamDir` (each selector clears
  the other two). Pass `activeProjectId={activeProject?.id ?? null}` and
  `onSelectProject` into the sidebar (desktop + mobile share `sidebarProps`).
- **Main pane** (`drive.lazy.tsx`): when `activeProject` is set, render a small
  local `ProjectFileBrowser` wrapper that fetches the project detail
  (`useProject(project.id)`) for its `capabilities`, derives
  `canManage = capabilities?.includes("files.manage") ?? false` (read-only until
  loaded — safe default), and renders `FileBrowser` with `ownerType="project"`,
  `ownerId={project.id}`, `rootLabel={project.name}`, keyed by project id. The
  wrapper keeps `DriveViewContent`'s hook order intact (no conditional hook after
  its `!userId` early return).
- **i18n** (`locales/{en,zh}/drive.json`): add `sidebar.section.projects`
  ("Projects" / "项目") and `sidebar.projectsEmpty` ("No projects" / "暂无项目").

## Verification

- `bun run check` exits 0 (lint, typecheck, web + api tests, build, check:i18n,
  check:api-docs, check:api-spec, check:routes).
- Manual: a non-admin member sees only their projects under "Projects";
  selecting one lists that project's files; a `files.manage` member can
  create/upload/rename, a viewer-only member gets a read-only browser; selecting
  a fixed view or team directory clears the active project and vice versa.

## Notes

- Known minor edge: a project member whose role lacks `files.view` still appears
  in the list (the list endpoint returns memberships, not file capabilities), so
  opening it surfaces the FileBrowser error banner from the 403. Acceptable and
  backend-enforced; not worth N per-project capability fetches to pre-filter.
