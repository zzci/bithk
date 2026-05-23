# Changelog

Track changes your fork makes on top of this template. Format adapted from
[Keep a Changelog](https://keepachangelog.com/) — group entries under
**Added / Changed / Removed / Fixed / Security**. The `Unreleased` block
holds work since your last tag.

Upstream cuts versioned tags so forks can anchor diffs against a known
template version. The boundary entries below summarise what shipped in
each upstream tag; your fork's `Unreleased` block sits at the top.

## Unreleased

### Changed

- Full-feature integration test pass across all modules. Re-pointed the
  stale live-stack e2e suites at the current API surface: issue CRUD /
  comments / attachments moved to the project-scoped
  `/api/projects/:projectId/issues[...]` routes, and drive sharing moved
  to the unified share module (`/api/shares/:type/:id`,
  `/api/shares/{received,sent,links}`, `/api/shares/:shareId`,
  public `/api/shared/:token[/download]`). Updated drive read assertions to
  the fail-closed 404 existence policy (no-relationship reads → 404). Added
  a live-stack `search` e2e module (global search + auth gate). Raised the
  `apps/web` vitest coverage floors from 14/12/14/10 to 29/29/29/24
  (statements/functions/lines/branches) to lock in the F1–F3 UI-suite gains.
  `bun run check` and `bun run test:e2e` (75 tests) both green. See
  [full-feature test report](task/full-feature-test-report.md).
- Issues are now a project-only sub-module — there is no global / personal
  issue. Every issue belongs to a project (`issue_details.project_id` is now
  `NOT NULL`) and is assigned to a `project_members.id`. All issue endpoints
  moved under `/projects/:projectId/issues[...]` (list, create, detail,
  update, delete, attachments, comments), gated by project membership +
  `resolveProjectIssueAccess`; the global `/issues*` routes were removed.
  The full issue detail panel (inline edit, status/priority/assignee, due
  date, comments, attachments, delete) is reachable via two routes: a drawer
  overlay nested under the project page
  (`/projects/$projectId/issues/$issueId`, the project detail stays mounted
  underneath) and a standalone fullscreen page
  (`/projects/$projectId/issues/$issueId/full`) reached via the drawer's
  maximize action or a deep link. Global search still surfaces
  issues but deep-links into the owning project and scopes to the projects a
  user belongs to (admins: all). Removed the global Issues sidebar entry.
  Breaking schema change (dev-stage, no data). See REFACTOR-002 / PLAN-009.

### Added

- Project module overhaul (settings hub): configurable per-project **roles**
  (`project_roles` + a capability set; route gates check capabilities, not role
  names; a seeded undeletable "Project Manager" role guards against lock-out),
  an **external contacts** directory (`project_contacts`, typed
  supplier/client/subcontractor/other — procurement now references a
  `type='supplier'` contact via `supplier_id`), **procurement categories**
  (`procurement_categories` + `category_id` on procurement, with category
  filtering), and user-defined **tags** (`tags` + `project_tags`, many-to-many).
  The project itself keeps only basic fields — name, code, description, status
  (`active` / `archived`), and tags. `project_members` is operator-only — real
  users or **virtual** users (own staff without a login account), carrying a
  `title` — and drops the old `member_type` / supplier columns; assignment
  targets stay `project_members.id`. Procurement visibility/mutation moved to
  the `procurement.view` / `procurement.manage` capabilities. Web: the project
  list is a card grid with a single mutually-exclusive chip filter (`All` /
  `Archived` / each tag; archived projects are hidden until the chip is picked),
  a tabbed **Project Settings** dialog hosts General / Members & Roles /
  Contacts / Procurement Categories (the standalone Members tab is gone), and
  procurement forms pick supplier + category from the new directories. EN/ZH
  i18n. Breaking schema change (dev-stage, no data). See FEAT-008 / PLAN-010.
- Document row actions + per-user pin: each tree row now exposes a "⋯"
  menu (new child, rename, pin/unpin, delete) replacing the hover-only "+".
  Pins are per-user (new `document_pins` table, kept out of authz tuples
  and out of the shared `document_details` so a shared doc can be pinned
  independently by each viewer), gated by `document:read`. The documents
  home, previously blank, now lists the caller's pinned documents (sorted
  by last update) and falls back to the create prompt when none are
  pinned. EN/ZH i18n. See FEAT-007 / PLAN-008.
- Engineering project management: a new `project` aggregate module
  (`projects` + a single `project_members` table for internal users and
  external supplier/webhook actors, promotable in place), a `procurement`
  `item` sub-type (5-state lifecycle, comment-based event log, grant-gated
  fail-closed visibility), a project dimension on `issue` (nullable
  `project_id` + `assignee_member_id`; personal issues unchanged), and a
  `project` drive `ownerType` (capabilities resolved against
  `project_members`, addressed by project shortId). Assignment targets are
  `project_members.id` so external members can be assigned without a
  `users` row. Admin-only project creation; project read is member-scoped.
  Portal frontend: project list + detail (Overview / Issues / Procurement /
  Files / Members tabs), member management, reused drive FileBrowser, EN/ZH
  i18n. Inbound/outbound events are designed only (see
  [project module doc](modules/project.md)). See FEAT-004 / PLAN-004.
- Markdown editor source view: a toolbar toggle (`FileCode2`) switches the
  Milkdown surface in place to an editable raw-markdown view backed by a
  CodeMirror 6 instance (markdown highlighting, line wrapping). Edits stream
  back into Milkdown on toggle-back; the CodeMirror chunk is lazy-loaded so
  WYSIWYG-only use never pays for it. Shown in full (non-compact) editors
  only. EN/ZH i18n. See FEAT-003 / PLAN-003.
- Drive web UI: a three-tab page (My files / Team directories / Shared
  with me) assembling the file browser, share dialog + lists, team-directory
  list + member management, and file preview into one route, with full
  EN/ZH i18n.
- Owner-aware folder and text-file creation from the UI — creating inside a
  team directory now produces team-owned entries (editor+ gated), wired
  through `useCreateDriveFolder` / `useCreateTextFile`.
- Live e2e coverage for owner-scoped entry listing and folder/text-file
  create gating by team-directory role.
- Faithful drive file preview: in-app full-bleed viewer rendering images
  (react-zoom-pan-pinch zoom/pan/rotate), PDFs (react-pdf paged render with
  thumbnails), markdown (sanitized preview), and code/text (shiki
  theme-synced highlight), with inline edit + save via version upload. The
  heavy renderers (react-pdf/pdfjs-dist, react-zoom-pan-pinch, shiki) and
  the pdf.js worker are lazy-loaded as on-demand chunks. See
  [decision 001](decisions/001-drive-preview-stack.md).
- `context-menu` UI primitive (`@base-ui/react/context-menu`) for right-click
  per-item and blank-area "create here" menus.
- Document collaborator sharing wired into the documents detail UI (add /
  remove user or group viewer/editor, inherited grants shown and
  non-removable), replacing the previous "coming soon" stub.
- Document public-link sharing: view-only token links with optional password
  (argon2id, write-only) and expiry, owner-only management, and folder/subtree
  recursion so a link on a folder grants view access to its whole subtree.
  Adds the `document_public_links` table + migration, unauthenticated token
  routes (gate metadata / content / attachment streaming), and a ShareDialog
  public-link section (create / revoke / copy URL) with EN/ZH i18n.
- Public documents viewer page (`/documents/shared/:token`): unauthenticated,
  view-only markdown rendering with password and expiry enforcement, subtree
  navigation for folder links, and attachment view/download.

### Changed

- Removed the `portal` concept from the frontend entirely. The dashboard
  moved from `/portal` to `/overview`, and module routes now mount at the
  root (`/drive`, `/documents`, `/issues`, `/projects`); `/admin/*` and the
  root redirect are unchanged. Default post-login landing and the drive share
  URL updated accordingly. The rename also covers the sidebar nav area
  (`NavArea` `portal` → `overview`), nav key/label, the `portal` i18n
  namespace (`portal.json` → `overview.json`, "Portal"/"门户" → "Overview"/"概览"),
  `denied.backToPortal` → `backToOverview`, and the `shared/components/portal/`
  document-tree utils directory → `shared/components/documents/`. React DOM
  portals (`createPortal`, `*.Portal`) are unrelated and untouched.
  See REFACTOR-001 / PLAN-006.
- Unified sharing into one `share` module backed by a single polymorphic
  `shares` table (`resource_type` + `resource_id`, no DB FK). Replaces the
  former per-module `document_public_links` and `drive_file_shares` tables and
  their duplicated services/routes. Resource specifics (validation, public
  content rendering, manage authorization) plug in through a per-resource
  adapter registry; documents and drive register adapters via side-effect
  imports. Management API: `/shares/:type/:id`, `/shares/:shareId`,
  `/shares/{received,sent,links}`, `/shares/capabilities/:type`. Public access:
  `/shared/:token` (+ `/list`, `/download[/:childId]`). Document collaborator
  (viewer/editor) grants stay policy tuples — out of scope. Breaking: drops the
  old tables and routes (no data migration). See FEAT-002 / PLAN-002.

- Documents selection now lives in the URL as a path param
  (`/portal/documents/:docId`) via a master-detail layout that keeps the tree
  sidebar mounted across switches; creating a document (root or child) now
  navigates to the new document instead of bouncing back to the empty state.

- Every drive entry list now renders through one reusable
  `DriveFileListSurface` (search / filter / sort / grid-list / multi-select /
  context menus), with folder vs collection toolbar configs. Consumers: the
  folder file-browser, the recent/favorites/trash entry list, the share
  lists, and the file picker.

### Removed

- Dead `-use-drive-selection.ts` hook (selection state now lives inside the
  shared surface).
- `document_public_links` and `drive_file_shares` tables and their
  `*.share.service.ts` / `*.public.routes.ts` modules, superseded by the
  unified `share` module. The former gap where `document_public_links` was
  never included in backups is closed by the new `share` backup contribution.

### Security

- Documents are now owner-scoped: the admin role no longer bypasses document
  access on list, read, tree, or share-management paths. Admins see only their
  own and explicitly shared documents, matching drive personal-file behavior.
  Breaking change (R&D): admins lose blanket visibility into other users'
  documents.

## 2026-05-21

### Removed

- libsql, the `encryption` module, and the locked/setup/unlock lifecycle.
  API now uses `bun:sqlite` directly via Drizzle's `bun-sqlite` adapter.
- Env vars `DB_ENCRYPTION`, `MASTER_PASSWORD_FILE`,
  `ENABLE_EXPERIMENTAL_DEK_ROTATION`.
- Endpoints under `/api/encryption` and the frontend `/setup` and
  `/unlock` routes.

This is a breaking change with no backward-compatibility path: at-rest
encryption is now the operator's responsibility (full-disk encryption,
volume-level encryption, or column wrapping at the application layer).

## v0.1.0 — 2026-05-14

First tagged template release. Subsequent forks should anchor their
`develop/forking.md` Part 2 (Tracking upstream) workflow against
`v0.1.0` or later.

### Added

- Bun monorepo skeleton (`apps/api`, `apps/web`, `packages/shared`,
  `packages/tsconfig`).
- Hono API with per-request DI (config / db / encryption / logger
  threaded through `c.var`).
- React 19 + TanStack Router web app with EN/ZH i18n and file-based
  routes.
- Shipped modules: `account/auth` (OAuth + TOTP), `account/users`,
  `policy` (Zanzibar tuples), `item` (base) + `file` / `document` /
  `issue` (sub-types), `cron`, `backup`, `audit`, `encryption`,
  `settings`, `system`.
- ECIES at-rest encryption with bootstrap-token, master-password
  derived keypair, and admin DEK challenge-response.
- Live e2e harness (dex + API + every module).
- Single-binary build via `scripts/compile.ts`.
- `scripts/rebrand.ts` rewrites manifests + `.env` defaults for forks.
- Doc-drift safeguards: `check:i18n` / `check:env-docs` /
  `check:api-docs`.
- `.github/workflows/ci.yml` + `release.yml`.

### Security

- Sentinel guards refuse production boot with example
  `OAUTH_CLIENT_SECRET=app-secret`, `OAUTH_CLIENT_ID=app`,
  `DEFAULT_ADMIN=admin@example.com`.
- `SERVICE_TOKEN` split into `SERVICE_TOKEN_METRICS` /
  `SERVICE_TOKEN_BACKUP` (independently rotatable).
- CSRF middleware (XHR header + Origin/Referer match), `__Secure-`-
  prefixed session cookies, PKCE + state binding for OAuth.

### Known issues

Tracked separately (lockout persistence, cookie scope vs `BASE_PATH`,
DNS-rebinding guard on the `http-request` cron action, …).
