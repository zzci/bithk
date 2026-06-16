# FEAT-035 Adopt hono-openapi: code-derived OpenAPI spec across all modules

- Status: In progress
- Plan: [PLAN-085](../plan/PLAN-085.md)
- Owner: local-session
- Updated: 2026-06-16

## Goal

The bithk skill must ship a complete, accurate OpenAPI spec without source
access at delivery time. Rather than hand-author or hand-curate the spec
(drift-prone), make the spec **derive from the code**: adopt `hono-openapi`
(`describeRoute` + `validator`) so every route documents itself and request
schemas come straight from the Zod validators that already run. This also
realigns the API with the `pma-bun` OpenAPI-aware baseline and removes manual
spec maintenance going forward.

Supersedes the earlier auto-stub offline generator (the `apps/api/scripts/api-spec/`
assembler) which is removed.

## Scope

### Foundation (done by L1)
- Deps: `hono-openapi` + peers (`@hono/standard-validator`, `@standard-community/standard-json`,
  `@standard-community/standard-openapi`, `openapi-types`), pinned exact.
- `apps/api/src/shared/lib/openapi.ts`: re-exports `describeRoute` / `validator`
  / `resolver`, a shared `ErrorEnvelope` zod schema, and `onValidationFailure`
  — a validator hook that returns the app's canonical `422 { success,error }`
  instead of hono-openapi's default `400` (preserves the error contract).
- `apps/api/scripts/lib/route-table.ts`: `buildApiApp()` (mount all routers) +
  `collectApiRoutes()`.
- `apps/api/scripts/gen-api-spec.ts`: `generateSpecs(buildApiApp(), …)` →
  `skills/bithk/references/api-spec.json` (+ `--check`). Coverage test asserts
  no `describeRoute` references a non-existent route.
- `apps/api/src/modules/tag/tag.routes.ts`: migrated as the **reference
  pattern** (describeRoute + validator on every route; param/query/json).

### Per-module migration (parallel BKD lanes)
Migrate every remaining module's `*.routes.ts` to `describeRoute` + `validator`
following the tag reference: projects (project+issue+procurement+item), ships
(ship+worklist), documents, drive, contacts, hr, account, policy, shares
(share+sharePublic), settings+system+search+file, audit+backup+cron.

### Final (L1)
Regenerate `api-spec.json` from the fully-migrated app; add the strict
100%-coverage gate; update the skill (point at `api-spec.json` as the complete
parameter reference); changelog + decision doc.

## Acceptance

- Every route carries `describeRoute`; request bodies/query/params validated via
  `validator(...)` with `onValidationFailure` (422 envelope unchanged).
- `gen:api-spec` produces a complete OpenAPI 3.1 `api-spec.json` covering all
  routes; coverage gate passes; no stale describeRoute.
- All existing route/e2e tests pass (behavior unchanged); `bun run check` EXIT 0.
- The skill ships the generated `api-spec.json` as the authoritative parameter
  reference (works without repo source).

## Notes

- 2026-06-16 — Foundation + tag reference landed; `bun run check` EXIT 0.
  hono-openapi@1.3.0. Validator returns its own 400 by default → preserved the
  422 envelope via `onValidationFailure` (returns the app envelope; throwing
  from the hook does NOT work — must return a Response). generateSpecs excludes
  routes without describeRoute, so coverage grows per migrated module.
