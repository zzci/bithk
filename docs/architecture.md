# Architecture

> Examples assume `BASE_PATH=/app`. The app is mounted at root (`/`) by default; set `BASE_PATH` to serve under a URL prefix.

This is a Bun monorepo template that provides an OAuth-backed internal workspace: account management, Zanzibar-style policy tuples, documents, issues, contacts, settings, audit logs, and JSON backup.

This document describes the implemented architecture in the current codebase. Planned integrations should live in separate roadmap or planning documents, not in current-state architecture docs.

In examples below, `${BASE_PATH}` is the configured URL prefix. Empty by default — leave the placeholder as `""` when reading the routes for a root-mounted deploy.

## Runtime Shape

```text
Browser
  |
  | ${BASE_PATH}/*
  v
App server
  |
  | ${BASE_PATH}/api/*
  v
Hono API
  |
  +-- public routes (always on: /health)
  +-- protected routes (business + admin, gated on session and role)
  +-- SQLite (bun:sqlite) via Drizzle ORM
```

The outer app serves:

| Mount | Purpose |
|---|---|
| `/` | HTML meta refresh to `${BASE_PATH}/` when `BASE_PATH` is set. Skipped when the app is root-mounted — the SPA already owns `/`. |
| `${BASE_PATH}/api` | Hono API. |
| `${BASE_PATH}/*` | Built SPA assets from packaged `dist`, with source-tree fallback to `apps/web/dist`. |

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| API | Hono |
| Database | SQLite via `bun:sqlite` through Drizzle ORM |
| Web | React, Vite, TanStack Router, TanStack Query |
| Styling | Tailwind CSS |
| Build | `scripts/package.ts` lode-compatible release artifact |
| Authentication | External OAuth/OIDC provider with authorization code + PKCE |
| Authorization | Global-role module visibility gate + local Zanzibar-style relation tuples |

## Repository Layout

```text
apps/
  api/
    src/
      app.ts
      config.ts
      db/
      modules/
      routes/
      shared/
  web/
    src/
      app/
      shared/
packages/
  shared/      # shared utilities used by api and web
  tsconfig/    # shared tsconfig
scripts/
tests/
  e2e/         # live e2e harness (dex + API + every module)
docs/
```

## API Module Layout

```text
apps/api/src/modules/
  account/
    auth/
    users/
    groups/
  audit/
  backup/
  contact/         # global shared contact directory
  cron/
  document/        # sub-type of item
  drive/           # personal + team file drive (folders, versions, shares)
  file/            # blob storage; pluggable drivers + content dedupe
  issue/           # sub-type of item
  item/            # base for content sub-types
  policy/
  ship/            # thin aggregate over project, issue, and drive
  settings/
  system/
  tag/             # central tag vocabulary + the shared tags_refs assignment table
```

| Module | Responsibility | Details |
|---|---|---|
| `account` | OAuth login, sessions, current user, users, groups, TOTP. | [account.md](modules/account.md) |
| `audit` | Persisted audit events + retention sweep. | [audit.md](modules/audit.md) |
| `backup` | JSON backup export and import (admin + service-token surfaces). | [backup.md](modules/backup.md) |
| `contact` | Global shared contact directory with owner/viewer authorization, public/private visibility, and confidential field masking. | [contact.md](modules/contact.md) |
| `cron` | In-process job scheduler: cron-driven actions with run history. | [cron.md](modules/cron.md) |
| `document` | Documents, attachments, comments, shares; sub-type of `item`. | [document.md](modules/document.md) |
| `drive` | Personal + team file drive: folders, file versions, direct / public-link shares. Owns its own tables (not a sub-type of `item`). | [drive.md](modules/drive.md) |
| `file` | Content-addressable blob storage with pluggable drivers and ref counting. | [file.md](modules/file.md) |
| `issue` | Issues, attachments, comments; sub-type of `item`. | [issue.md](modules/issue.md) |
| `item` | Base primitive for content sub-types (common metadata + comments + permission edges). | [item.md](modules/item.md) |
| `policy` | Zanzibar-style relation tuples, check, expand, resource groups. | [policy.md](modules/policy.md) |
| `ship` | Ship aggregate: core ship records, equipment, maintenance templates, project-backed work orders, and base-project files. | - |
| `settings` | Runtime key/value settings store. | [settings.md](modules/settings.md) |
| `system` | Health probes, build version, Prometheus metrics, upload limits. | [system.md](modules/system.md) |
| `tag` | Central tag vocabulary plus the shared `tags_refs` assignment table; owns all tag storage so no other module needs a tag join table. | - |

## Ship Module

The ship module is a thin aggregate over existing project, issue, and drive
building blocks. Creating a ship also creates a base project and links the two
with `ships.base_project_id` and `projects.ship_id`; the creator is seeded as
that project's Project Owner.

Ship authorization is anchored on the base project. Reading a ship requires
base-project membership (app admins bypass); writes require `project.manage` on
the base project. A caller with no base-project relationship receives the
standard fail-closed `404`.

Maintenance work orders are ordinary project issues in the ship's bound
projects. A work order is identified by an `issue_references` soft reference
with `refType="maintenance_template"` pointing at a ship-level maintenance
template. Missing template targets degrade to `template: null` so historical
issues remain readable.

Ship files reuse drive's existing `project` owner type with
`ownerType=project&ownerId=<baseProjectId>`. The ship module does not add a
ship-specific file store or change drive behavior.

## Tag Module

Tags are owned centrally by the `tag` module. **Modules MUST NOT own their own
tag table.** All tag storage and assignment go through the tag module: it owns
both the tag vocabulary (the `tags` table, keyed by `type` —
`project | contact | document | issue | procurement`) and the assignment
storage.

Assignments live in one generic many-to-many table, `tags_refs(resource_id,
tag_id)`, with PK `(resource_id, tag_id)`, an index on `tag_id` for reverse
lookup, `tag_id` FK -> `tags.id` `ON DELETE CASCADE`, and no FK on `resource_id`
(it points at projects / contacts / items generically; the source type is
derived from the joined tag row). There are no per-domain tag join tables.

A source registry lets the tag module validate `type` without importing any
domain schema, so the dependency only ever points from domains into the tag
module. Because `resource_id` has no FK cascade, each domain removes its
`tags_refs` rows at the application level when a resource is deleted. See
[decision 006](decisions/006-unify-tags-into-tag-module.md).

## UI Conventions

- **Button sizing.** Interactive buttons follow one app-wide standard: non-icon
  buttons use the `Button` default size (`h-8`) and icon-only buttons use
  `size="icon"` (`size-8`); `size`/height overrides are avoided on the common
  case so new buttons inherit the right size by default. The size tokens in
  `apps/web/src/shared/components/ui/button.tsx` are the source of truth. See
  [decision 007](decisions/007-button-sizing-standard.md).
- **Mobile / responsive.** Breakpoints, touch targets, toolbar/table/drawer/
  dialog patterns are documented in
  [develop/mobile-responsive.md](develop/mobile-responsive.md).

## Request Flow

```text
Request
  -> request ID (+ propagation for outbound calls)
  -> CORS
  -> app context injection (db, config, logger)
  -> request logging
  -> CSRF guard
  -> policy middleware (auto-gates routes declared via defineResource.routes)
  -> route group
  -> module visibility gate (first on the protected router: 404 for module routes outside the actor's global role)
  -> authRequired where the module requires a session
  -> adminRequired where the module requires admin privileges
  -> handler
  -> shared error handler
```

## Authentication Flow

```text
Unauthenticated user
  -> GET /app/api/account/auth/login
  -> OAuth authorization endpoint
  -> GET /app/api/account/auth/callback
  -> token exchange with PKCE verifier
  -> local user create/update
  -> session cookie
  -> redirect back to requested page
```

Sessions are stored in SQLite. The browser stores only the HTTP-only session cookie.

### Session token storage

Each session row carries the upstream OAuth `access_token` and `refresh_token` as plain columns. The database file is not encrypted at rest — anyone with read access to `app.db` (filesystem, snapshot, leaked backup) gets the tokens. Operators that need defence-in-depth should wrap the file in full-disk encryption or column-level wrapping at the application layer (Drizzle's `defaultFn` is a reasonable seam).

`DEFAULT_ADMIN` is the bootstrap input: whenever the user table contains no rows with `role=admin`, the next login matching the configured username or email is promoted. Non-admin users may sign up at any time without locking the bootstrap window — the gate is on admin presence, not on user-count zero.

OAuth/OIDC provider configuration is read from environment variables at runtime. The admin settings UI does not own these values, which prevents a bad database setting from breaking login.

## Authorization Model

Authorization is layered: a global-role **module visibility gate** decides
which main-area modules a user can see at all, then the relation-tuple policy
engine and per-project roles decide what the user can do inside a module.

### Global roles and module visibility

Each user holds exactly one global role (`users.global_role_id`); `NULL`
resolves to the system default role (kind=`default`, name "Member"), which a
boot backfill guarantees exists. A role grants a set of module keys from the
static `MODULES` registry (`apps/api/src/shared/modules.ts`):
`documents`, `drive`, `projects`, `ships`, `contacts`, `hr`. The default
Member role seeds with every key except `hr`, so existing users keep exactly
the visibility they had before the feature landed.

Enforcement:

- **API.** A module gate runs first on the protected router. A request whose
  path is claimed by a module outside the actor's allowed set is answered
  with the same 404 used for nonexistent resources — fail-closed concealment
  per [decision 003](decisions/003-fail-closed-404-existence-policy.md)
  extended to the module level, so hidden modules are indistinguishable from
  routes that do not exist. Admins (`users.role === "admin"`) bypass without
  a role lookup; the resolved module set is cached per request. A route
  coverage test asserts every prefix mounted on the protected router is
  claimed by exactly one `MODULES` entry or explicitly listed in
  `UNGATED_PREFIXES`.
- **`/account/me`.** Returns the resolved `modules` list; the web app treats
  it as the single source of truth for module visibility.
- **Web.** Sidebar items carrying a `module` key, the command palette
  sections, and a generic `_app` module guard (deep links redirect to
  `/overview`) all filter on `me.modules`.
- **Search.** Global search restricts result domains to the actor's visible
  modules.

Admin-area modules (users, policies, audit, cron, settings, backup, and the
`/global-*` vocabularies including `/global-roles` itself) are NOT
role-grantable: they keep their existing `adminRequired` guards. Cross-cutting
surfaces (`/account`, `/search`, `/tags`, `/files`, `/shares`, …) stay
ungated. One deliberate consequence: a user who is a member of a project but
whose role lacks the `projects` module loses project access — the module gate
wins over membership.

### Relation tuples

The policy module stores relation tuples in `relation_tuples` and exposes check and expand operations. Admin users bypass policy checks where the route explicitly uses `adminRequired`.

Tuple example:

```text
document:abc123#viewer@group:dev-team#member
group:dev-team#member@user:user123
```

The `contact` namespace protects the global contact directory. Each contact has
an `owner` relation for full management and a `viewer` relation for explicit
per-user or per-group read grants. Public contacts are readable by any
authenticated user through the contact permission hook; private contacts require
owner/admin access or an explicit viewer grant. Confidential public contacts
mask contact fields for implicit public viewers and keep only the name and tags
visible; owners, admins, and explicit viewers see the full row.

## Data Storage

Runtime data paths are resolved from env configuration. In lode-packaged runs,
`ROOT_DIR` points at the installed artifact directory for read-only assets.
Mutable paths resolve under `DATA_DIR` when set. If `DATA_DIR` is omitted and
`LODE_DATA_DIR` is present, the app uses `${LODE_DATA_DIR}/data`, so one
persistent `/srv/lode` mount can hold both lode state and app data:

| Path | Purpose |
|---|---|
| `DB_PATH` | SQLite database. |
| `DB_PATH` sibling `.pid` file | PID lock file. |
| `FILE_STORAGE_LOCAL_ROOT` | Uploaded files and content-addressed blobs. |
| `LOG_FILE` | Structured JSON logs when not writing to stdout. |
