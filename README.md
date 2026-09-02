# bit.hk

A Bun monorepo template for OAuth-backed internal workspaces. Ships with:

- **API** — Hono on Bun, SQLite (`bun:sqlite`) via Drizzle.
- **Web** — React 19 + TanStack Router + Tailwind v4, file-based routes, dual EN/ZH i18n.
- **Modules** — account/auth (OAuth + TOTP), groups, Zanzibar relation tuples, `item` base + `file` storage, documents, issues, cron, settings, audit logs, archive backup.
- **Build** — lode-compatible tarball artifact via `scripts/package.ts`.

## Quick start

```bash
bun install
cp .env.example .env       # uncomment the "Bundled dex IdP" block
bun run dev:all            # starts dex + web + api in one process group
```

Open the URL printed by `bun run dev:all` (e.g. `http://bit.localhost:3355`). Sign in with `admin@example.com` / `admin` — the bundled dex's static user. The first matching login becomes admin per `DEFAULT_ADMIN`.

Already have an OAuth/OIDC provider? Point `OAUTH_ISSUER` at it in `.env` and use `bun run dev` instead — `dev:all` detects an external issuer and bows out so it doesn't fight your IdP.

### Reset local state

After `bun run dev:all` has run, `data/` contains the SQLite DB, uploaded blobs, and the OIDC discovery cache. To start over:

```bash
bun run clean        # build artefacts only (dist/, .vite/, .tanstack/, coverage/)
bun run clean:all    # also wipes data/ — DB, uploads, logs, oidc cache
```

`clean:all` is destructive; uncommitted local data is gone. Use it on a fresh clone or after intentionally tearing down a local experiment.

## Customize

- **Identity** — set `APP_NAME` (slug) and `APP_DISPLAY_NAME` in `.env`. HTML title, TOTP issuer, backup filename, and sessionStorage namespace derive from these. `BASE_PATH` is unset by default (root mount); set it to serve under a URL prefix. See [`docs/develop/forking.md`](docs/develop/forking.md).
- **Modules** — keep what you need, drop the rest. See [`docs/README.md`](docs/README.md) §3. To add one, follow [`docs/develop/module/playbook.md`](docs/develop/module/playbook.md) (10-step checklist) with starter files in [`docs/develop/module/recipe.md`](docs/develop/module/recipe.md).
- **Logo** — replace `apps/web/public/logo.svg` and the inline SVG in `apps/web/src/shared/components/logo.tsx`.

## Commands

```bash
bun run dev            # Vite dev server (web + API via @hono/vite-dev-server)
bun run dev:all        # dev + bundled dex IdP, one process group
bun run dev:dex        # just the bundled dex IdP (use when running dev in another terminal)
bun run rebrand        # rewrite manifests + .env defaults for a fork
bun run build          # Build all packages
bun run lint           # ESLint
bun run typecheck      # tsc --noEmit
bun run test           # Unit tests (bun:test + vitest)
bun run test:e2e       # Live e2e: dex + API + every module
bun run check          # lint + typecheck + test + build + check:i18n + check:env-docs + check:api-docs
bun run gen:env-docs   # regenerate docs/reference/env-reference.md from the zod schema + .env.example
bun run gen:api-docs   # regenerate docs/reference/api-routes.md from the in-process Hono routes
bun run package        # Build a lode-compatible release artifact
bun run clean          # Remove build artifacts
```

## Layout

```text
apps/api/          Hono API; Drizzle schema lives per-module
apps/web/          React 19 SPA (TanStack Router file-based)
packages/shared/   Shared utilities used by both api and web
packages/tsconfig/ Shared TS config
docs/              Architecture, module standards, deployment, rebranding
tests/e2e/         Live e2e harness (dex + API)
scripts/           dev-all / dev-dex / rebrand / package / clean / hash-password
                   / check-i18n / find-unused-i18n / clean-unused-i18n / gen-env-docs
```

## Documentation

- [`docs/README.md`](docs/README.md) — using the template
- [`docs/architecture.md`](docs/architecture.md) — runtime shape
- [`docs/develop/module/standards.md`](docs/develop/module/standards.md) — adding a module
- [`docs/develop/forking.md`](docs/develop/forking.md) — full rebranding checklist
- [`docs/develop/deployment.md`](docs/develop/deployment.md) — production deployment + upgrade
- [`docs/develop/operations.md`](docs/develop/operations.md) — runbook (logrotate, backup, restore, known issues)
- [`docs/develop/forking.md`](docs/develop/forking.md) — merging upstream template changes
- [`docs/modules/`](docs/modules) — per-module deep dives
