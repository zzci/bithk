# 013 — Personal Access Token scope model

- Status: accepted
- Date: 2026-06-16
- Review by: 2026-12-16
- Scope: how Personal Access Tokens (FEAT-034) authenticate and how their
  per-module scope is modelled and enforced. Files:
  `apps/api/src/modules/account/tokens/*`,
  `apps/api/src/shared/middleware/api-token-scope.ts`,
  `apps/api/src/modules/account/index.ts` (provider chain), and the web
  `apps/web/src/shared/components/api-tokens-panel.tsx`.
- Related: PLAN-084 / FEAT-034; decision 003 (fail-closed existence policy);
  the group-based module visibility gate (PLAN-076 / FEAT-032) whose
  `MODULES` registry covers only the 6 nav modules.

## Context

The only user-level authentication was the OIDC session cookie, so a CLI or AI
agent could not act as a user. Service tokens are global, scoped only to
`metrics`/`backup`, and carry no identity. The requirement: a user (or an admin
acting for any user, including virtual users) mints a bearer token that drives
the full API as that user, scoped per module.

## Decisions

1. **Identity, not a separate principal.** A PAT resolves to its owning `users`
   row through a chained auth provider (cookie first, then PAT). Every existing
   `policyMiddleware` / `moduleGate` / `adminRequired` check then applies
   unchanged. No parallel permission model.

2. **Scope is an intersection, enforced independently of the admin
   short-circuit.** `apiTokenScopeGuard` runs on the protected router for PAT
   requests only and caps access to the token's per-module level
   (`read` = safe methods, `write` = mutating). Effective access =
   `owner policy permissions ∩ token scope`. Because `policyMiddleware`
   short-circuits admins, the scope guard is deliberately separate so an
   **admin's token is still bounded** — that is the whole point of a scoped
   token (limit blast radius below the owner's full power).

3. **A complete scope taxonomy, not the nav-module registry.** The nav-module
   `MODULES` registry covers only documents/drive/projects/contacts/hr
   (`ships` was folded into `projects` by
   [ADR-015](./015-projects-as-sections.md)); everything else is "ungated". A
   token must be able to address *every* route, so PAT scope uses its own
   ~17-key taxonomy, derived alongside `MODULES` from the single
   `shared/module-manifest.ts`, that maps every protected prefix to exactly one
   key. A coverage test (`scope.test.ts`) enumerates the real
   mounted routes and fails if any prefix is unmapped — so a new route cannot
   ship unscoped. Unmapped paths fail closed (403) for PAT requests.

4. **Token management is session-only.** A PAT cannot mint, list, or revoke
   tokens; those routes reject a PAT (403) and require a cookie session. This
   blocks token-farming / privilege escalation. Self-service lives in the
   account settings centre; admins mint for any user (incl. virtual users, who
   cannot log in) from Admin → Users.

5. **Secret hygiene.** `bithk_pat_<base64url(32B)>`, shown once, stored as a
   SHA-256 hash (looked up by hash). Expiry is required; expired/revoked tokens
   resolve to no identity (401). CSRF is unaffected — pure-bearer requests carry
   no cookie and were already exempt.

## Consequences

- A new additive `api_tokens` table + one migration; no change to the OIDC/
  cookie flow, the policy engine, the service-token paths, or the 6-key
  `MODULES` registry.
- The PAT scope taxonomy is a second module list to keep honest; the coverage
  test is the guardrail.
- No per-token rate-limit beyond the existing auth limiter, and no IP
  allow-list — possible follow-ups, out of FEAT-034 scope.
