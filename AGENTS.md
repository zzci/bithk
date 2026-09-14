# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `CLAUDE.md` is a symlink to `AGENTS.md` — edit `AGENTS.md`.

## Agent Rules

- Chinese must not appear in documentation or code unless the user explicitly requests Chinese documentation.
- When committing to a remote repository, collaborator information and Chinese text must not appear.
- Communication with the user should primarily be in Chinese.
- Keep responses concise and direct.

## Project Development

This repository follows the PMA workflow. The actual rules live in the `/pma`
skill and the stack skills below; do not duplicate them here. If a rule in this
file ever conflicts with `/pma`, treat `/pma` as the source of truth and update
this file.

### Skill Stack

- `/pma` — workflow control, three-phase gate, task and plan tracking
- `/pma-bun` — Bun API/backend implementation baseline
- `/pma-web` — React + Vite frontend implementation baseline

### Triggers

Any feature, bug fix, refactor, planning, progress tracking, or multi-agent
execution goes through `/pma` (investigate -> proposal -> implement). Do not
skip phases. Do not implement before explicit approval such as `proceed`.

### Local Divergences

Any deliberate deviation from a skill rule is recorded in `docs/decisions/`
with a sunset date. Do not silently override skill rules in this file.

### Documentation Entry Points

- Tasks: `docs/task/index.md`
- Plans: `docs/plan/index.md`
- Decisions: `docs/decisions/`
- Architecture: `docs/architecture.md`
- Changelog: `docs/changelog.md`
- Module rules: `docs/develop/module/` (`playbook.md` = checklist, `standards.md` = rationale, `policy-standard.md` = access control contract)
- Per-module behaviour: `docs/modules/<name>.md`

## Commands

Runtime is Bun 1.4.0 (Node 24.20 only for compatible tooling).

```bash
bun install
cp .env.example .env       # uncomment the "Bundled dex IdP" block
bun run dev:all            # dex IdP + web + api in one process group (nsl prints the URL)
bun run dev                # web + api only; use when OAUTH_ISSUER points at a real IdP
bun run dev:dex            # bundled dex alone
```

Dev URLs are routed by nsl (`bit.localhost`, `bit.a.fr.ds.cc`). Sign in with
`admin@example.com` / `admin` against the bundled dex; the first matching login
is promoted per `DEFAULT_ADMIN`. Local state (DB, uploads, oidc cache) lives in `data/`.

Quality gate (must pass before work is complete):

```bash
bun run check              # lint + typecheck + test + build + i18n/env/api-doc/spec/type drift checks
```

Targeted runs:

```bash
bun run --filter @app/api test                       # bun:test suite (apps/api)
bun run --filter @app/api test document.test         # single api test by name filter
bun run --filter @app/web test                       # vitest + coverage (apps/web)
bunx vitest run src/shared/lib/http.test.ts          # single web test (from apps/web)
bun run test:e2e                                     # live e2e: boots dex + API, runs tests/e2e/modules/*
bun run smoke                                        # playwright smoke routes
bun run test:browser                                 # build + playwright acceptance
```

API tests run with `--env-file=/dev/null` so a local `.env` never leaks into them.
CI enforces an api coverage floor (line ≥ 80%, function ≥ 70%) in `.github/workflows/ci.yml`.

Generated artifacts — regenerate and commit whenever the source changes, or
`bun run check` fails on drift:

```bash
bun run --filter @app/api db:generate   # drizzle migration after any module schema.ts change (commit meta/_journal.json too)
bun run --filter @app/web build         # regenerates apps/web/src/app/routeTree.gen.ts (never hand-edit)
bun run gen:env-docs                    # docs/reference/env-reference.md from the zod schema + .env.example
bun run gen:api-docs                    # docs/reference/api-routes.md from the live Hono routes
bun run gen:api-spec                    # OpenAPI spec
bun run gen:api-types                   # apps/web/src/shared/lib/api/_generated/api-types.ts
```

Other: `bun run package` (lode release artifact), `bun run seed`, `bun run rebrand`,
`bun run clean` (build output), `bun run clean:all` (**destructive** — also wipes `data/`:
SQLite DB, uploads, oidc cache).

## Architecture

Bun monorepo: `apps/api` (Hono), `apps/web` (React 19 SPA), `packages/spreadsheet`,
`packages/tsconfig`. Both apps alias `@/*` to their own `src/`.

### Request path

`apps/api/src/app.ts` is the single wiring point. `bootstrap()` loads config,
opens + migrates SQLite (`bun:sqlite` via Drizzle), then `buildFullApp()` mounts
the API and `buildOuterApp()` wraps it: security headers/CSP, an optional
`BASE_PATH` redirect, `${BASE_PATH}/api` for Hono, and `${BASE_PATH}/*` for the
built SPA. `BASE_PATH` is empty by default (root mount).

Global middleware order: `requestId` → `propagateRequestId` → `cors` →
context injection (`db` / `config` / `logger`) → logging → `csrfGuard` →
`policyMiddleware`. Routes split into `routes/public.ts` (no session) and
`routes/protected.ts` (everything else). Boot **fails closed** if no policy
route bindings registered — that would silently disable authorization.

Background workers start in `buildFullApp()`: audit retention, backup staging
sweep, file GC, cron (opt-in via `CRON_ENABLED`), notification consumers,
webhook dispatcher. `wireRuntime()` is the worker-less path used by offline CLI
backup import/export.

### Module system

A module under `apps/api/src/modules/<name>/` owns its `schema.ts`, routes,
service, `<name>.backup.ts`, tests, docs and i18n. Shared aggregate files are
**registries only** — at most one line per module:
`db/schema.ts`, `routes/protected.ts`, `policy/namespace-config.ts`,
`apps/web/src/shared/components/sidebar/registry.ts`, and `MODULE_DIRS` in
`tests/e2e/run.ts`. Defining tables, middleware, or i18n values directly in an
aggregate file is rejected at review.

Key invariants (full rationale in `docs/develop/module/standards.md`):

- **Content modules compose `item`** — a user-created object gets `<name>_details(item_id PK)`
  plus the shared `items` row; comments, attachments (`file_references` → `files`),
  relations and soft delete already belong to `item`. `document` and `issue` are the worked examples.
- **Authorization is Zanzibar-style** — modules call `defineResource({...})` and
  `requirePermission(access, "verb")`; they name *actions*, never relations. Relation
  tuples live in `relation_tuples`; the engine is `policy/zanzibar.engine.ts`.
- **Backup is a registry** — every table-owning module registers a `BackupContribution`
  (tables + string `deps`, plus `importFallbacks` / `importTransforms` when its schema
  changes shape). `modules/backup/` never learns about individual modules.
- **Every write audits** — `audit(db, logger, {...})` with action `<module>.<resource>.<verb>`;
  failures are recorded too.
- Response envelopes: `{ success: true, data, meta? }` / `{ success: false, error: { code, message } }`.
- IDs: 8-char nanoid for business entities, ULID for append-only tables (audit).
- Services read `c.get("config")`, never `Bun.env`. No new global middleware.
- Size caps: api files ≤ 800 lines, web route entries ≤ 1500, other web files ≤ 800.

### Web

File-based TanStack Router under `apps/web/src/app/routes/`. Non-route
co-located files **must** use the `-` prefix (`-issue-panel.tsx`) or they are
registered as routes. Server state goes through TanStack Query, UI state through
Zustand or local state — do not mix. All HTTP goes through
`apps/web/src/shared/lib/http.ts` (CSRF + lock detection live there); never call
`fetch` directly. i18n uses filesystem-derived namespaces
(`src/locales/<lng>/<ns>.json`); new module strings never go into `common.json`,
and EN/ZH must stay in sync (`bun run check:i18n`).

### Style

antfu ESLint config: double quotes, semicolons, 2-space indent, type-only
imports required, `any` banned in production code. Generated files
(`routeTree.gen.ts`, `api-types.ts`, `drizzle/`, `shared/components/ui/`) are lint-ignored.

## Shell

- Prefer `bash` for all command execution.
- Do not use `zsh` unless the user explicitly requests it.
- Never use unfiltered port-kill commands.

## Git

- Use English for commit messages, pull request titles, pull request descriptions, and other remote-visible Git metadata.
- Do not mention AI assistants, agents, or model names in commit messages, pull request text, comments, or any other remote-visible content.
