# Architecture

> Examples assume `BASE_PATH=/app`. The app is mounted at root (`/`) by default; set `BASE_PATH` to serve under a URL prefix.

This is a Bun monorepo template that provides an OAuth-backed internal workspace: account management, Zanzibar-style policy tuples, documents, issues, settings, audit logs, and JSON backup.

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
| `${BASE_PATH}/*` | Embedded SPA assets when production assets are present. |

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| API | Hono |
| Database | SQLite via `bun:sqlite` through Drizzle ORM |
| Web | React, Vite, TanStack Router, TanStack Query |
| Styling | Tailwind CSS |
| Build | `scripts/compile.ts` single-binary build |
| Authentication | External OAuth/OIDC provider with authorization code + PKCE |
| Authorization | Local Zanzibar-style relation tuples |

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
```

| Module | Responsibility | Details |
|---|---|---|
| `account` | OAuth login, sessions, current user, users, groups, TOTP. | [account.md](modules/account.md) |
| `audit` | Persisted audit events + retention sweep. | [audit.md](modules/audit.md) |
| `backup` | JSON backup export and import (admin + service-token surfaces). | [backup.md](modules/backup.md) |
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

## Ship Module

The ship module is a thin aggregate over existing project, issue, and drive
building blocks. Creating a ship also creates a base project and links the two
with `ships.base_project_id` and `projects.ship_id`; the creator is seeded as
that project's Project Manager.

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

The policy module stores relation tuples in `relation_tuples` and exposes check and expand operations. Admin users bypass policy checks where the route explicitly uses `adminRequired`.

Tuple example:

```text
document:abc123#viewer@group:dev-team#member
group:dev-team#member@user:user123
```

## Data Storage

Runtime data is stored below `ROOT_DIR`:

| Path | Purpose |
|---|---|
| `data/db/app.db` | SQLite database. |
| `data/db/app.pid` | PID lock file. |
| `data/logs/app.log` | Structured JSON logs. |
