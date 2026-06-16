# PLAN-084 Personal Access Tokens + repo skill for AI-driven API access

- status: completed
- createdAt: 2026-06-16 12:00
- approvedAt: 2026-06-16 12:00
- relatedTask: FEAT-034

## Context

- API is plain Hono (no OpenAPIHono), 259 routes / ~20 modules, with an
  auto-generated `docs/reference/api-routes.md`.
- The only user-level auth provider is `oauthSessionAuthProvider`
  (`apps/api/src/modules/account/auth/auth.service.ts`), registered via
  `registerAuthProvider` in `apps/api/src/modules/account/index.ts`. It reads
  the session cookie only — no bearer/user-token path exists today (grep for
  `api_token`/PAT is empty).
- Service tokens (`shared/middleware/service-token.ts`) are global static
  secrets scoped only to `metrics`/`backup`, with no user identity (audited as
  `system`). `login-local` is single-user-mode only. Neither satisfies
  "a user hands an AI agent a token to act as themselves".
- `csrfGuard` (`shared/middleware/csrf.ts`) already exempts pure-bearer
  requests (no cookie) — the bearer channel is anticipated but unimplemented.
- Authorization is enforced globally by `policyMiddleware`
  (`modules/policy/middleware.ts`): it matches a route via the `RouteBinding`
  registry, loads the actor through `getAuthProvider()`, and **short-circuits
  for admins** before any policy query. Order in `app.ts`:
  `csrfGuard` → `policyMiddleware` → mount `publicRoutes()` + `protectedRoutes()`.
- `moduleGate` (`modules/account/groups/module-gate.ts`) already conceals the
  6 nav modules a user can't see, using `MODULES`/`moduleForPath` from
  `shared/modules.ts`. That registry covers only `documents/drive/projects/
  ships/contacts/hr`; everything else is `UNGATED_PREFIXES` (cross-cutting /
  admin). `moduleForPath` returns null for those — so it cannot, by itself,
  back a scope model that must cover *all* routes.
- Module visibility is group-based (FEAT-032). Virtual users are first-class
  `users` rows (isVirtual) and cannot log in — admin minting is the only way
  to give them a token.

## Proposal

### A. Backend — PAT auth and scope

1. **Schema + migration.** Add `apiTokens` to the account module schema; let
   Drizzle Kit generate the migration (never hand-write). Columns per
   FEAT-034. Unique index on `tokenHash`; index on `userId`.

2. **Token service** (`modules/account/tokens/tokens.service.ts`):
   `generateToken()` → `bithk_pat_<base64url(32B)>`; `hashToken()` (SHA-256);
   `createToken`, `listTokensForUser`, `revokeToken`, `findActiveByHash`
   (rejects revoked/expired), `touchLastUsed` (best-effort).

3. **Scope taxonomy** (`modules/account/tokens/scope.ts`): a complete ordered
   `TOKEN_MODULES` `{ key, prefixes }` table covering every protected prefix,
   reusing `MODULES` prefixes for the 6 nav modules and adding the rest:
   `tags, files, shares, search, account, settings, policy, audit, backup,
   cron, system`. `tokenModuleForPath(path)` returns the scope key (fail-closed
   null → deny for PAT). `levelForMethod(method)`: safe → `read`, else `write`.
   Scope value type: `Record<scopeKey, "read" | "write">` (absent = none).
   A `tokens.scope.coverage.test.ts` asserts every `RouteBinding` path + every
   protected mount maps to exactly one scope key (mirrors the existing
   route-coverage test pattern), so a new route cannot ship unmapped.

4. **Auth provider chain** (`modules/account/auth` or tokens module):
   `apiTokenAuthProvider(db, c)` — parse `Authorization: Bearer bithk_pat_…`,
   hash, `findActiveByHash`, on hit set `c.set("apiToken", { id, scopes })`,
   `touchLastUsed`, return the user. A `chainedAuthProvider` tries the cookie
   provider first, then the PAT provider; registered via `registerAuthProvider`
   in `modules/account/index.ts` (replaces the bare cookie registration).

5. **Scope guard** (`shared/middleware/api-token-scope.ts`), mounted in
   `app.ts` immediately after `policyMiddleware` (so the actor/`apiToken` is
   resolvable) — actually it resolves the provider itself idempotently like
   `policyMiddleware`/`moduleGate`. Logic: if `c.get("apiToken")` is unset
   (cookie request) → `next()`. Else compute `tokenModuleForPath(strippedPath)`
   + `levelForMethod`; require the token scope to grant ≥ that level; else
   `403 TOKEN_SCOPE_INSUFFICIENT`. Runs regardless of admin role. `GET
   /account/me` is always allowed (identity).

6. **Management routes** (`modules/account/tokens/tokens.routes.ts`),
   cookie-session-only (reject when `c.get("apiToken")` is set → 403):
   - Self: `GET/POST /account/me/tokens`, `DELETE /account/me/tokens/:id`.
   - Admin: `GET/POST /account/users/:id/tokens`,
     `DELETE /account/users/:id/tokens/:tokenId` (`adminRequired`).
   POST validates name + required `expiresAt` (server clamps to an allowed max)
   + scope map (zod, keys ∈ TOKEN_MODULES, values ∈ {read,write}); returns the
   one-time plaintext. Audit `token.created` / `token.revoked`.

### B. Web — token management UI

- `apps/web` account settings: an "API Tokens" tab/section — list (name, scope
  summary, expiresAt, lastUsedAt, createdAt, revoked badge), a create dialog
  (name, expiry preset select, per-module scope matrix none/read/write), a
  one-time secret reveal step (copy button + "store it now" warning), revoke
  with confirm. TanStack Query hooks; shadcn/ui only (per `pma-web` lock).
- Admin Users area: a per-user "API Tokens" panel reusing the same components,
  hitting the admin routes, available for virtual users too.
- i18n keys en + zh.

### C. Skill — `skills/bithk/`

- `SKILL.md` (front-matter name/description) + `reference/` files: auth header,
  base URL/`BITHK_URL`/`BITHK_TOKEN`, response envelope, error codes incl.
  `TOKEN_SCOPE_INSUFFICIENT`, the scope model, the full route catalog
  (reference `docs/reference/api-routes.md` to avoid drift), curl recipes
  (create work order `POST /projects/:projectId/issues`; upload
  `POST /drive/files/upload`; attachments; per-module CRUD), pagination/filter,
  shortId-vs-id, multipart upload notes.

### D. Docs

- `docs/changelog.md` entry; `docs/reference/api.md` token-auth + scope section;
  `docs/decisions/013-personal-access-token-scope.md` for the scope taxonomy
  and the cookie-only-management / admin-short-circuit-independence calls.

### Verification

- Unit tests (token service, scope map coverage, provider chain, scope guard),
  route tests (`check:routes`), `gen:api-docs` regen for the new routes,
  `bun run check` (lint + typecheck + test + routes + build + i18n + env-docs +
  api-docs).

## Risks

- PAT is a long-lived high-privilege credential: leak = full impersonation of
  that user within scope. Mitigations: hash-at-rest, one-time reveal, required
  expiry, revoke, scope intersection, audit. (Rate-limiting beyond the existing
  auth limiter is a possible follow-up, not in scope.)
- The scope guard must be admin-short-circuit-independent, or admin tokens
  would be unbounded — main correctness risk; covered by a guard test with an
  admin owner.
- Scope-map completeness drift — covered by the coverage test.
- Destructive surface is one additive table + one migration; no change to
  existing auth/policy/service-token paths.

## Scope

- Backend: `apps/api/src/modules/account/tokens/*` (new), `…/account/index.ts`,
  `…/account/users/schema.ts` (+ generated migration), `app.ts` (mount guard),
  `shared/middleware/api-token-scope.ts` (new), tests.
- Web: account-settings API-tokens section + admin per-user panel + hooks +
  i18n.
- Skill: `skills/bithk/*` (repo-local only).
- Docs: changelog, api.md, one decision doc.
- Unchanged: OIDC/cookie flow, policy engine, service tokens, the 6-key
  `MODULES` registry.

## Alternatives

1. Skill + service token — rejected: no user identity; only metrics/backup.
2. Skill via `login-local` cookie — rejected: needs a password, single-user
   mode only, must also carry CSRF headers.
3. PAT without scope — rejected by the user; scope (none/read/write per module)
   is required.
4. Reuse the 6-key `MODULES` for scope and bucket everything else as one "core"
   key — simpler UI, but cannot express read/write over admin/cross-cutting
   surfaces and undersells "cover all functionality". Chosen: a complete
   ~17-key taxonomy (open for the user to trim).
5. Global `~/.claude/skills/bithk` (global) — rejected; the skill lives in the repo at `skills/bithk/`.

## Annotations

- 2026-06-16 — User confirmed direction (A backend PAT + B skill). Decisions:
  scope required, per-module, three levels none/read/write; expiry required;
  token management in the user settings center this round; virtual users must
  have tokens and admins can mint tokens for a target user; skill lives in the
  repo only. Refined scope taxonomy (~17 keys) and cookie-only management are
  proposed here pending final `proceed`.
