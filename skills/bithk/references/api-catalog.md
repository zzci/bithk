# bithk API catalog

> This is the human-readable module map (which endpoint, which scope). For a
> route's **exact parameters and responses**, query the complete OpenAPI 3.1
> spec shipped with this skill: `references/api-spec.json`.

Every route is under `$BITHK_URL` (the `/api` root) and needs
`Authorization: Bearer $BITHK_TOKEN`. The **scope** column is the token module
key + level the route requires: `read` = `GET`/`HEAD`, `write` = any mutating
method. Effective access is always also bounded by the owning user's own
permissions.

Conventions:
- `:projectId`, `:shortId`, `:id` are path ids — list a collection first to
  learn them. Ships use a `shortId`; projects/issues use ids returned by list.
- Most domains expose `comments` and `attachments` sub-resources with an
  identical shape (`GET`/`POST .../comments`, `POST .../attachments` multipart,
  `GET .../attachments/:aid` to download).
- Response envelope: `{ success, data }` or `{ success, error }`.

## Scope module keys

`documents drive files projects ships contacts hr tags shares search account settings policy audit backup cron system`

---

## projects (scope: `projects`)

Projects, work orders (issues), and procurement all live under `projects`.

| Method | Path | Scope |
|---|---|---|
| GET/POST | `/projects` | read / write |
| GET/PATCH/DELETE | `/projects/:id` | read / write |
| POST/DELETE | `/projects/:id/cover-image` | write |
| GET/POST | `/projects/:id/members` · PATCH/DELETE `/members/:memberId` | read / write |
| GET/POST/PATCH/DELETE | `/projects/:id/roles[/:roleId]` | read / write |
| GET/POST/PATCH/DELETE | `/projects/:id/procurement-categories[/:categoryId]` | read / write |
| GET/POST | `/projects/:projectId/issues` (work orders) | read / write |
| GET/PATCH/DELETE | `/projects/:projectId/issues/:id` | read / write |
| GET/POST/DELETE | `/projects/:projectId/issues/:id/attachments[/:aid]` | read / write |
| GET/POST/DELETE | `/projects/:projectId/issues/:id/comments[/:cid]` | read / write |
| POST | `/projects/:projectId/issues/:id/pin` · `/unpin` | write |
| GET/POST | `/projects/:projectId/procurements[/:id]` (+ `/status`, `/pin`, `/comments`, `/attachments`) | read / write |
| GET | `/projects/:projectId/pinned-items` · `/referenceable-worklists` | read |
| GET | `/issues/:issueShortId/references` · POST/DELETE `/references[/:referenceId]` | read / write |
| GET/POST/PATCH/DELETE | `/global-procurement-categories[/:id]` (admin vocab) | read / write |

Work-order create body: `{ title (req), description?, status?, priority?, assigneeMemberId?, dueDate?, tags? }`
where `status` ∈ `todo|working|review|done|cancel`, `priority` ∈ `low|medium|high|urgent`,
and `assigneeMemberId` is a `project_members.id`. Comment body field is `content`.
**Full field-level detail in `work-orders.md`.**

## ships (scope: `ships`)

| Method | Path | Scope |
|---|---|---|
| GET/POST | `/ships` | read / write |
| GET/PATCH/DELETE | `/ships/:shortId` | read / write |
| POST/DELETE | `/ships/:shortId/cover-image` | write |
| GET/POST/DELETE | `/ships/:shortId/projects[/:projectShortId]` | read / write |
| GET/POST/PATCH/DELETE | `/ships/:shortId/equipment[/:equipmentId]` | read / write |
| GET/POST/PATCH/DELETE | `/ships/:shortId/equipment-categories[/:categoryId]` | read / write |
| GET/POST/PATCH/DELETE | `/ships/:shortId/worklists[/:id]` | read / write |
| GET/POST/PATCH/DELETE | `/global-equipment-categories[/:id]` (admin vocab) | read / write |
| GET/POST/PATCH/DELETE | `/global-equipment-manufacturers[/:id]` (admin vocab) | read / write |
| GET/POST/PATCH/DELETE | `/worklists[/:id]` (global worklist KB, admin) | read / write |

## documents (scope: `documents`)

| Method | Path | Scope |
|---|---|---|
| GET/POST | `/documents` · GET `/documents/tree` · `/groups` · `/tags` · `/users` | read / write |
| GET/PATCH/DELETE | `/documents/:id` · PATCH `/move` · PUT/DELETE `/pin` | read / write |
| GET/POST/DELETE | `/documents/:id/attachments[/:aid]` | read / write |
| GET/POST/DELETE | `/documents/:id/comments[/:cid]` (+ `/attachments`) | read / write |
| GET/POST/DELETE | `/documents/:id/shares[/:shareId]` | read / write |

## drive (scope: `drive`)

| Method | Path | Scope |
|---|---|---|
| GET | `/drive/entries` · `/favorites` · `/recent` · `/search` | read |
| GET/PATCH/DELETE | `/drive/entries/:id` (+ `/restore`, `/permanent`, `/content`) | read / write |
| POST | `/drive/files/upload` (multipart `file`, optional `parentEntryId`) | write |
| POST | `/drive/folders` · `/drive/entries/text-file` · `/entries/spreadsheet` | write |
| GET/POST | `/drive/entries/:id/versions[/:versionId/current]` | read / write |
| POST/PATCH/DELETE | `/drive/entries/:id/edit-lock` (+ `/heartbeat`, `/live-content`) | write |
| GET/POST/PUT/DELETE | `/drive/team-directories[/:id]` (+ `/members[/:memberId]`) | read / write |

## files (scope: `files`)

| GET | `/files/:id/content` · `/files/:id/metadata` | read |

Attachment **content** download endpoint shared by every module's attachments.

## contacts (scope: `contacts`)

| Method | Path | Scope |
|---|---|---|
| GET/POST | `/contacts` | read / write |
| GET/PATCH/DELETE | `/contacts/:id` | read / write |
| POST/DELETE | `/contacts/:id/avatar` | write |
| POST | `/contacts/:id/grant` · `/revoke` | write |
| GET/POST/PATCH/DELETE | `/contact-categories[/:id]` | read / write |

## hr (scope: `hr`)

| Method | Path | Scope |
|---|---|---|
| GET/POST/PATCH/DELETE | `/hr/colleagues[/:id]` (+ `/attachments[/:aid]`) | read / write |
| GET/POST/DELETE | `/hr/approvals[/:id]` · POST `/:id/decision` | read / write |
| GET/POST/PATCH/DELETE | `/hr/payroll[/:id]` | read / write |

## tags (scope: `tags`)

| GET/POST/PATCH/DELETE | `/tags[/:id]` | read / write |

## shares (scope: `shares`)

| Method | Path | Scope |
|---|---|---|
| GET | `/shares/sent` · `/received` · `/links` · `/capabilities/:type` | read |
| GET/POST | `/shares/:type/:id` | read / write |
| PATCH/DELETE | `/shares/:shareId` | write |

(The public `/shared/:token` access surface needs no auth and is not token-scoped.)

## search (scope: `search`)

| GET | `/search?q=…` | read |

## account (scope: `account`)

| Method | Path | Scope |
|---|---|---|
| GET | `/account/me` | always allowed |
| GET | `/account/me/groups` · `/account/assignable-users` · `/visible-users` | read |
| GET/PUT | `/account/me/preferences/:key` | read / write |
| GET/POST/PATCH/DELETE | `/account/users[/:id]` (+ `/groups`) | read / write |
| GET/POST/PATCH/DELETE | `/account/groups[/:id]` (+ `/members[/:userId]`) | read / write |

Token-management routes (`/account/me/tokens`, `/account/users/:id/tokens`) and
TOTP routes are **session-only** — a PAT cannot call them (403).

## settings (scope: `settings`)

| GET/PUT/DELETE | `/settings[/:key]` | read / write |
| GET/POST/DELETE | `/admin/project-default-cover` | read / write |

## policy (scope: `policy`)

| POST | `/policy/check` · `/policy/expand` | write |
| GET | `/policy/manifest` · `/entities` · `/resource-groups` · `/tuples` · `/users/:id/access` | read |
| POST/PATCH/DELETE | `/policy/tuples[/:id]` (+ `/batch`) · `/policy/resource-groups[/:id]` | write |

## audit (scope: `audit`)

| GET | `/audit` · `/audit/:id` | read |

## backup (scope: `backup`)

| POST | `/backup/export` · `/backup/import` · `/backup/v2/exports` · `/backup/v2/imports` | write |
| GET | `/backup/modules` · `/backup/v2/exports/:jobId` (+ `/download`) | read |

## cron (scope: `cron`)

| GET | `/cron/actions` · `/cron/jobs` · `/cron/jobs/:id/logs` | read |
| POST/DELETE | `/cron/jobs[/:id]` (+ `/pause`, `/resume`, `/trigger`) | write |

## system (scope: `system`, mostly public)

| GET | `/system/branding` · `/system/version` · `/system/upload-limits` · `/health` · `/metrics` | read |
