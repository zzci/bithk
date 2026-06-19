# PLAN-090 Decouple session lifetime from access-token TTL + background refresh

- **status**: draft
- **createdAt**: 2026-06-19 12:55
- **approvedAt**: (pending)
- **relatedTask**: FIX-046

## Context

See FIX-046 for the full root cause. Summary of the current state:

- `apps/api/src/modules/account/auth/schema.ts` — `sessions` has a single
  `expiresAt text not null`; this column is currently overloaded as "access
  token expiry".
- `auth.service.ts:385 createSession(db, userId, accessToken, refreshToken, expiresIn)`
  writes `expiresAt = now + (expiresIn ?? 3600) * 1000`.
- `auth.service.ts:425 updateSessionTokens(...)` (refresh path) re-derives the
  same `expiresAt` from `expires_in`.
- `auth.service.ts:471 oauthSessionAuthProvider` checks `isSessionExpired(session.expiresAt)`;
  on expiry it refreshes only if `session.refreshToken` exists, else tears the
  session down.
- `auth.routes.ts` calls `createSession` in three places with inconsistent 5th args:
  - `:485` OIDC main flow → `tokens.expires_in` (the bug)
  - `:711` single-user → `authCfg.sessionMaxAge` (already correct)
  - `:841` TOTP completion → `challenge.expiresIn` (the bug)
- `oidc.ts:134` authorize scope hard-coded `"openid profile email"` (no
  `offline_access`).
- Cookie `maxAge` is already `authCfg.sessionMaxAge` at all three write sites, so
  the cookie side needs no change.
- Migration tool: `drizzle-kit generate` (`apps/api` `db:generate`); current
  migrations are `0000`–`0002`. Schema changes must be emitted by the tool, never
  hand-written (PMA rule 10).

## Proposal

Combined approach: `SESSION_MAX_AGE` becomes the application session ceiling, and
the access token gets its own expiry with background refresh.

### 1. Schema — add one column (`schema.ts`)

Add a nullable access-token-expiry column to `sessions`; repurpose `expiresAt` to
mean "session ceiling".

```ts
export const sessions = sqliteTable("sessions", {
  // ...
  refreshToken: text("refresh_token"),
  expiresAt: text("expires_at").notNull(),                 // now = session ceiling
  accessTokenExpiresAt: text("access_token_expires_at"),   // NEW, nullable
  // ...
});
```

Nullable avoids a NOT-NULL-default table rebuild and reads naturally: `null` =
"no access-token refresh needed / unknown". Then run `bun --filter @app/api db:generate`
to emit `0003_*.sql`. Do not hand-edit it.

### 2. `createSession` signature (`auth.service.ts`)

Take both the session ceiling and the access-token TTL explicitly:

```ts
export async function createSession(
  db: AppDatabase,
  userId: string,
  accessToken: string,
  refreshToken: string | undefined,
  sessionMaxAge: number,             // seconds → expiresAt (ceiling)
  accessTokenExpiresIn: number | undefined,  // seconds → accessTokenExpiresAt
): Promise<string> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionMaxAge * 1000).toISOString();
  const accessTokenExpiresAt = accessTokenExpiresIn == null
    ? null
    : new Date(Date.now() + accessTokenExpiresIn * 1000).toISOString();
  // insert expiresAt + accessTokenExpiresAt
}
```

### 3. Refresh path (`auth.service.ts` `updateSessionTokens`)

Update only `accessTokenExpiresAt` (and tokens); leave `expiresAt` untouched so
the ceiling never slides:

```ts
.set({
  accessToken,
  refreshToken: refreshToken ?? undefined,
  accessTokenExpiresAt: expiresIn == null ? null : new Date(Date.now() + expiresIn * 1000).toISOString(),
  updatedAt: now,
})
```

### 4. `oauthSessionAuthProvider` (`auth.service.ts`)

Two-clock logic; refresh failure is no longer fatal while within the ceiling:

```ts
// hard ceiling
if (isSessionExpired(session.expiresAt)) {
  await deleteSession(db, sessionId);
  clearSessionCookie(c, config.NODE_ENV, config.BASE_PATH);
  return undefined;
}

// access token stale but session still valid → best-effort refresh
const tokenExpired = session.accessTokenExpiresAt != null
  && new Date(session.accessTokenExpiresAt).getTime() <= Date.now();
if (tokenExpired && session.refreshToken) {
  try {
    await refreshSessionWithMutex(db, session.id, session.refreshToken, config);
  } catch {
    // within ceiling → keep the user logged in with a stale access token;
    // log and continue rather than tearing the session down.
  }
}

return user;
```

### 5. Call-site alignment (`auth.routes.ts`)

All three pass `authCfg.sessionMaxAge` for the ceiling and the IdP TTL separately:

- `:480` OIDC main → `createSession(db, user.id, tokens.access_token, tokens.refresh_token, authCfg.sessionMaxAge, tokens.expires_in)`
- `:711` single-user → `createSession(db, user.id, SINGLE_USER_ACCESS_TOKEN, undefined, authCfg.sessionMaxAge, undefined)` (no token expiry → null)
- `:841` TOTP → `createSession(db, challenge.userId, challenge.accessToken, challenge.refreshToken ?? undefined, authCfg.sessionMaxAge, challenge.expiresIn ?? undefined)`

### 6. Scope (`oidc.ts:134`)

```ts
url.searchParams.set("scope", "openid profile email offline_access");
```

So cooperating IdPs return a refresh token (dev dex already supports it via
`refreshTokens.validIfNotUsedFor: 24h`).

### 7. Tests

- `auth.service.test.ts`:
  - access token expired + refresh token present → refreshed, user resolved.
  - **regression**: access token expired + no refresh token + within ceiling →
    user still resolved (reproduces FIX-046).
  - `expiresAt` past (ceiling reached) → session deleted, undefined.
- oidc authorize-URL test asserts scope contains `offline_access`.

## Risks

- **Migration 0003 collision**: an unmerged campaign may also add `0003`. Confirm
  no drift (`db:generate` produces a clean single migration) before merge.
- **Existing session rows**: post-migration `accessTokenExpiresAt` is null and the
  old `expiresAt` was an access-token timestamp, so live sessions may need one
  re-login. Acceptable — dev `sessions` table is empty.
- **`offline_access` on prod IdP**: the deployed IdP client must allow the scope,
  or authorization errors. dex is fine; document for prod IdP config.
- **Stale access token survives longer**: the app does not use the access token
  for per-request auth (only login-time userinfo and logout revoke), so the blast
  radius is small; logout revoke of a stale token is a no-op.

## Scope

- `apps/api/src/modules/account/auth/schema.ts`
- `apps/api/drizzle/0003_*.sql` (generated)
- `apps/api/src/modules/account/auth/auth.service.ts`
- `apps/api/src/modules/account/auth/auth.routes.ts`
- `apps/api/src/modules/account/auth/oidc.ts`
- tests: `auth.service.test.ts` (+ oidc authorize-url test)
- `docs/changelog.md`

Out of scope: real-time session revocation, sliding-window ceiling renewal,
configurable per-IdP scope.

## Alternatives

- **Scope only (`offline_access`)**: insufficient — short-TTL IdPs still refresh
  every request and a refresh failure still logs the user out.
- **Decouple only (`expiresAt = sessionMaxAge`, no refresh)**: fixes the logout
  but the access token is never refreshed, so logout-time revoke uses a stale
  token and any future access-token use breaks.
- **Combined (this plan)**: fixes the logout, keeps the access token fresh when a
  refresh token is available, and degrades gracefully when it is not.
