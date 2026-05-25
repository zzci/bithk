# PLAN-015 Preserve login across new tabs

- **status**: completed
- **createdAt**: 2026-05-25 00:00
- **approvedAt**: 2026-05-25 14:05
- **relatedTask**: FIX-004

## Context

The user reports that single-user mode asks for login again when opening the
app in another tab. The backend single-user path is cookie-backed:

- `apps/api/src/modules/account/auth/auth.routes.ts` creates a session in
  `POST /account/auth/login-local` and writes the session cookie with
  `writeSessionCookie`.
- `apps/api/src/modules/account/auth/session-cookie.ts` uses a host/path scoped
  HttpOnly cookie (`session_id` in development/test, `__Secure-session_id` in
  production).
- `apps/api/src/modules/account/auth/auth.service.ts` resolves authenticated
  requests by reading the session cookie and joining `sessions` to `users`.
- `apps/api/src/modules/account/users/users.routes.ts` serves `/account/me`
  behind `authRequired`.

That means another tab on the same origin should be authenticated as soon as
it calls `/account/me`.

The frontend issue is route-level behavior:

- `apps/web/src/app/routes/index.tsx` always navigates `/` to `/login`, even
  for an already-authenticated browser.
- `apps/web/src/app/routes/login.tsx` only loads `/account/auth/mode`; it does
  not check `/account/me`, so an existing cookie is ignored and the form is
  shown.
- `apps/web/src/app/routes/_app.tsx` already has the correct protected-route
  guard: when `/overview` mounts, it calls `fetchUser()` and only redirects to
  `/login` on a clean unauthenticated response.

## Proposal

1. Make `/` redirect to `/overview` instead of `/login`.
   - Verify: root route renders a navigate target of `/overview`.
2. On `/login`, call `fetchUser()` once before loading/rendering auth mode.
   - If authenticated, navigate/replace to the safe redirect target.
   - If unauthenticated, render the existing single-user/OAuth UI.
   - If the server cannot be reached, keep the current fallback behavior for
     the login mode request.
   - Verify: login page with a successful `fetchUser()` does not render the
     password form and navigates to the redirect target.
3. Keep backend session semantics unchanged.
   - Verify: existing auth/session tests remain valid.

## Risks

- The login page currently has no route-level loader, so the fix should stay
  inside component effects to avoid changing the TanStack Router setup.
- The root redirect change depends on the existing `_app` guard; if that guard
  regresses later, `/` will no longer independently force login.
- A valid cookie is still origin-scoped. Opening a different hostname
  (`bit.localhost` versus another domain) will not share cookies and is out of
  scope for this fix.

## Scope

Frontend only:

- `apps/web/src/app/routes/index.tsx`
- `apps/web/src/app/routes/login.tsx`
- focused route tests where practical

Out of scope:

- Cross-domain cookie sharing.
- OAuth/TOTP flow changes.
- Backend session schema or cookie attributes.

## Alternatives

- Keep `/` pointing at `/login` and only add a login-page session check. This
  would fix the visible prompt, but `/` would still take an unnecessary detour
  through public login code.
- Persist frontend auth state in `localStorage`. This is weaker than asking
  the server via the existing HttpOnly cookie and can go stale.

## Annotations

- 2026-05-25 00:00 — Investigation completed; awaiting approval to implement.
- 2026-05-25 14:05 — User approved implementation.
- 2026-05-25 14:12 — Implementation completed and verified with focused route
  tests and the full `bun run check` gate.
