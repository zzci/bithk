# PLAN-085 Adopt hono-openapi for a code-derived OpenAPI spec

- status: implementing
- createdAt: 2026-06-16 16:30
- approvedAt: 2026-06-16 16:30
- relatedTask: FEAT-035

## Context

The skill ships without source, so its OpenAPI spec must be self-contained and
complete. Hand-authoring/curating it (the earlier `api-spec/` generator) is
drift-prone. The API is plain Hono with inline `schema.parse(await c.req.json())`
validation and a custom `{success,error}` / 422 envelope; `pma-bun`'s baseline
is OpenAPI-aware Hono. User chose `hono-openapi` (middleware: `describeRoute` +
`validator`) over `@hono/zod-openapi` (full `OpenAPIHono`/`createRoute` rewrite)
because it is additive — keeps plain Hono, `:param` paths, sub-routers, the
policy route-binding registry, and handler signatures intact.

Verified: `hono-openapi@1.3.0` works with hono 4.12 + zod 4.4; `validator`
auto-adds request schemas to the spec but answers failures with its own `400`
— so a shared `onValidationFailure` hook returns the app's `422` envelope
instead. `generateSpecs` excludes routes lacking `describeRoute`.

## Proposal

1. Foundation (L1, done): deps; `shared/lib/openapi.ts` (helper + hook +
   `ErrorEnvelope`); `scripts/lib/route-table.ts` `buildApiApp()`;
   `scripts/gen-api-spec.ts` via `generateSpecs`; coverage test; migrate `tag`
   as the reference. Remove the old `scripts/api-spec/` assembler.
2. Per-module migration via parallel BKD worktree lanes (file-disjoint by
   module). Each lane edits only its module's `*.routes.ts`, NOT `api-spec.json`
   (L1 regenerates at merge). Lane check: typecheck + lint + the module's own
   route tests + `gen:api-spec` shows its routes (no stale).
3. L1 reviews + merges each lane to main, regenerates `api-spec.json`, keeps
   main green; after all merged, add the strict 100%-coverage gate + update the
   skill + changelog + decision doc.

## Risks

- Migrating the validation layer of a live API: behavior must not change.
  Mitigations: `onValidationFailure` preserves the 422 envelope (proven); each
  module's existing route tests are the per-lane regression gate; full
  `bun run check` + e2e at the end.
- Multipart routes (uploads/attachments) have no JSON validator — documented
  via `describeRoute` requestBody `multipart/form-data` only; lanes must not
  force a json validator there.
- `c.req.param("id")` infers `string | undefined` under the validator chain →
  validate path params with `validator("param", …)` (the tag reference shows
  this).
- During migration the spec is partial (grows per module); strict 100% gate is
  added only at the end so main stays green per-merge.

## Scope

- `apps/api/src/shared/lib/openapi.ts`, `apps/api/scripts/*` (gen + route-table
  + test), `apps/api/src/modules/*/**.routes.ts` (migration), `apps/api/package.json`,
  `skills/bithk/references/api-spec.json`, docs.
- Out: changing route behavior/paths, the policy engine, the PAT feature,
  `@hono/zod-openapi` (rejected — full rewrite).

## Alternatives

- `@hono/zod-openapi` (OpenAPIHono + createRoute): matches the baseline word and
  type-enforces responses, but a full router-layer rewrite (path format, handler
  signatures, mandatory response schemas, policy/route-binding revalidation) —
  rejected as disproportionate/high-risk for retrofitting 306 routes.
- Offline generator with hand-curated params (prior FEAT, superseded) — drift.
- zod `z.toJSONSchema()` offline generator — drift-free requests, zero API
  change, but not idiomatic and responses still hand-authored; user preferred
  the in-code idiomatic approach.

## Annotations

- 2026-06-16 — User chose hono-openapi (over @hono/zod-openapi after comparison)
  to standardize every module so the spec is code-derived and maintenance-free.
  Foundation + tag reference landed green.
