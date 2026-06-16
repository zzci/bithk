# FEAT-034 Personal Access Tokens + repo skill for AI-driven API access

- Status: Completed
- Plan: [PLAN-084](../plan/PLAN-084.md)
- Owner: local-session
- Updated: 2026-06-16

## Goal

Today the only user-level authentication is the OIDC session cookie (dex). A
CLI or AI agent cannot drive the API as a user because it cannot run the
browser OAuth flow, and the existing service tokens are global, scoped only to
`metrics`/`backup`, and carry no user identity. Add per-user **Personal Access
Tokens (PAT)** so a user (or an admin acting for any user, including virtual
users) can mint a bearer token, then have an AI agent call the full REST API as
that user — create work orders, upload files, etc. Ship a repository-local
skill that teaches an AI agent to drive the entire bithk API with such a token.

## Scope

### Backend — PAT auth (`apps/api`)
- New `api_tokens` table (Drizzle-generated migration): `id`, `userId` (FK
  users, cascade), `name`, `tokenHash` (SHA-256, unique index), `prefix`
  (plaintext identifier for display), `scopes` (JSON per-module level),
  `expiresAt` (required), `lastUsedAt`, `createdAt`, `revokedAt`.
- Token format `bithk_pat_<base64url(32B)>`; plaintext returned only once at
  creation; stored as a hash; lookup by hash.
- `apiTokenAuthProvider` + a chained provider (cookie first, then PAT) wired
  through the existing `registerAuthProvider`. On a PAT match it resolves the
  owning user and stashes the token id + scopes on the request context.
- Per-module scope model with three levels — `none` / `read` / `write` (write
  implies read). A complete path→scope-module map covering **every** route
  (the 6 nav modules plus the cross-cutting and admin surfaces), with a
  route-coverage test asserting no route is unmapped.
- `tokenScopeGuard` middleware enforcing token scope as an intersection on top
  of the existing `policyMiddleware` / `moduleGate` / `adminRequired` — applied
  **independently of the admin short-circuit** so a token always limits blast
  radius below the user's full power. `read` = safe methods, `write` =
  mutating methods.
- Token-management routes (cookie-session-only; a PAT cannot mint/list/revoke
  tokens):
  - Self: `GET/POST /api/account/me/tokens`, `DELETE /api/account/me/tokens/:id`.
  - Admin (any user, incl. virtual): `GET/POST /api/account/users/:id/tokens`,
    `DELETE /api/account/users/:id/tokens/:tokenId`.
- Audit token create/revoke; best-effort `lastUsedAt` update; reject expired /
  revoked tokens. CSRF guard already exempts pure-bearer requests — no change.

### Web — token management UI (`apps/web`)
- Account settings center: "API Tokens" section — list own tokens, create
  dialog (name, required expiry preset, per-module scope matrix none/read/write),
  one-time secret reveal with copy + warning, revoke.
- Admin Users area: per-user (incl. virtual) token panel to create/list/revoke
  tokens for that user (the only way to obtain a virtual user's token).
- i18n (en + zh), query hooks.

### Skill — repository-local (`skills/bithk/`)
- `SKILL.md` + reference files. Inputs `BITHK_URL` + `BITHK_TOKEN`. Documents
  bearer auth, response envelope `{success,data,error}`, error codes (incl.
  `TOKEN_SCOPE_INSUFFICIENT`), the scope model, the full module/route catalog
  (referencing `docs/reference/api-routes.md`), and curl recipes for the common
  workflows (create work order, upload file/attachment, all-module CRUD),
  pagination/filtering, shortId-vs-id, and multipart upload.

### Docs
- `docs/changelog.md`, `docs/reference/api.md` (token-auth + scope section),
  a decision doc for the PAT scope taxonomy.

Out of scope: OAuth client-credentials / machine accounts; rotating tokens;
IP allow-lists; rate-limiting beyond the existing auth limiter (may be a
follow-up); changing the OIDC/cookie flow, the policy model, or service tokens.

## Acceptance

- A user can mint a PAT (self) and an admin can mint one for any user incl.
  virtual; the plaintext is shown once and never again.
- `Authorization: Bearer bithk_pat_…` authenticates API calls as the owning
  user; expired/revoked tokens are rejected (401).
- Scope is enforced as an intersection: a request to a module the token lacks
  the required level for is rejected (403 `TOKEN_SCOPE_INSUFFICIENT`) even for
  admin owners; cookie sessions are unaffected.
- Every route maps to exactly one scope module (coverage test passes).
- Token-management routes reject PAT auth (cookie-only).
- The `skills/bithk` skill lets an agent create a work order and upload
  a file end-to-end with only a base URL + PAT.
- `bun run check` passes.

## Notes

- 2026-06-16 — Completed. Backend: `api_tokens` table + migration
  `0001_demonic_richard_fisk.sql`; `tokens/` module (schema, scope taxonomy,
  service, provider, routes); chained auth provider (cookie → PAT);
  `apiTokenScopeGuard` mounted on the protected router after `moduleGate`. Web:
  reusable `ApiTokensPanel` wired into the settings centre (self) and Admin →
  Users per-user dialog (incl. virtual users) + `tokens` i18n (en/zh). Skill:
  repo-local `skills/bithk/` (SKILL.md + api-catalog + recipes). Docs:
  api.md auth section, decision 013, changelog. All gates green
  (`bun run check` EXIT 0; api 1856 tests, +new token/scope/guard suites).
- Discovered during this work: `apps/api/scripts/gen-api-docs.ts` omitted the
  ship / search / worklist routers, so `docs/reference/api-routes.md` was an
  incomplete index. Fixed under [FIX-045](FIX-045.md) (now 306 routes).
