# PLAN-089 Editable user name + upstream username sync + virtual-user email binding

- **status**: completed
- **createdAt**: 2026-06-19 11:00
- **approvedAt**: 2026-06-19 11:30
- **completedAt**: 2026-06-19 11:45
- **relatedTask**: FEAT-038

## Context

Investigation findings (current state).

### Schema — no migration needed

`apps/api/src/modules/account/users/schema.ts`: `users` already has `name`
(notNull), `username` (notNull, unique), `email` (notNull, unique), `oauthSub`
(notNull, unique), `isVirtual` (default false). Virtual users are created with
synthetic `oauthSub = virtual:<id>` and `email = <username>@virtual.local`.
All required columns exist → **no Drizzle migration**.

### Service — `users.service.ts`

- `updateUser(db, id, {role?, status?})` — real-user admin edits; does NOT touch
  name/username/email.
- `updateVirtualUser(db, id, {name?, username?})` — virtual-only; username
  uniqueness pre-checked; does NOT touch email.
- `createVirtualUser(db, {username, name})` — derives `email` from username.
- `listActiveUsers` excludes `isVirtual` rows (sharing/comment pickers);
  `listAssignableUsers` includes them.

### Routes — `users.routes.ts`

- `updateBodySchema = { role?, status?, name?, username? }`.
- PATCH `/account/users/:id`: rejects `name`/`username` for real users
  ("Only virtual users can be renamed"); role/status handled in a tx with
  last-admin guard + session purge; name/username delegated to
  `updateVirtualUser`.
- No `email` field anywhere in the update path.

### Auth login/sync — `auth.service.ts` `upsertUser`

- Existing user matched by `oauthSub`: updates `name`, `email`, `avatar`,
  `lastLoginAt` every login — **name is clobbered from IdP on every login** and
  `username` is NOT re-synced.
- Take-over/rebind path (no oauthSub match): finds a row by `username` OR (only
  when `email_verified`) `email`, then rebinds it — sets `oauthSub`, `username`
  (from upstream), `name = userInfo.name ?? conflict.name`, `email`, `avatar`.
  **Does NOT clear `isVirtual`.** This is the mechanism that already converts a
  matching virtual row to the real identity in place (keeping its id and
  cascaded project memberships) — but the leftover `isVirtual=true` keeps the
  bound user hidden from real-user pickers, and the IdP name overwrites any
  locally-set name.

### Frontend — `admin/users/index.lazy.tsx`

- Real users: only an enable/disable button. No name edit.
- Virtual users: edit (username+name) and delete via `VirtualUserDialog`.
- `VirtualUserDialog` posts/patches `{ username, name }` only; no email field.

## Proposal

A coherent ownership model:

- **Identity continuity = `sub` only.** Once a row has an `oauthSub`, every later
  login resolves it by `oauthSub == sub`. Username/name are NOT re-derived from
  the token on re-login, so an upstream rename never desyncs the local row.
- **`name`** — locally owned. Editable for all users. Seeded from the IdP only
  when a brand-new real user is first inserted; never clobbered afterward.
- **`username`** — upstream-originated but locally STABLE. Set from the IdP only
  at brand-new-user creation; for virtual users set by the admin. NEVER re-synced
  on login or on bind/take-over (a matched row keeps its existing username). Not
  locally editable for real users; editable for virtual users (no upstream yet).
- **`email`** — for real users, still synced from the upstream token each login
  (it is the upstream identity). For virtual users, locally editable
  (uniqueness-checked) — the binding key, frozen to upstream once bound.
- **binding** — convert a matching virtual row in place: set `oauthSub`, clear
  `isVirtual`, preserve the local name AND username.

### 1. `users.service.ts`

- Add `name` to `updateUser` (applies to any user).
- Extend `updateVirtualUser` to accept `email?` with a uniqueness pre-check
  (mirrors the username check; 409 on collision, self excluded).
- Optionally accept an explicit `email?` in `createVirtualUser` (falls back to
  the `<username>@virtual.local` default when omitted).

### 2. `users.routes.ts`

- `updateBodySchema`: add `email: z.string().email().max(255).optional()`.
- PATCH handler: allow `name` for ALL users (route name through `updateUser` /
  the virtual update as appropriate); keep `username` + `email` virtual-only
  (reject for real users — real email/username are IdP-owned). Audit the email
  change.
- `createVirtualUserSchema`: add optional `email`.

### 3. `auth.service.ts` `upsertUser`

- Existing-user (oauthSub) path: **stop overwriting `name`** (drop the
  `userInfo.name ??` clobber) AND do NOT re-sync `username` (already untouched
  today — keep it that way). Identity is keyed on `sub`, so an upstream rename
  must not desync the local row. Keep updating `email`/`avatar`/`lastLoginAt`.

- **Virtual-user binding (FEAT-038) — username AND email** (no-oauthSub branch).
  IdPs may expose distinct `preferred_username` and `username` claims, so collect
  both as lowercase candidates and require a verified email:

  ```
  candidates = unique([preferred_username, username].filter(present).map(lower))
  emailTrusted = email_verified === true && email !== ""
  ```

  Find a VIRTUAL row to convert:
  1. **Username present:** when `candidates.length > 0` and `emailTrusted`, match
     `isVirtual = true AND email = <email> AND username IN candidates`
     — i.e. a username claim AND the email must both match.
  2. **No username claims (exception):** when `candidates.length === 0` and
     `emailTrusted`, match `isVirtual = true AND email = <email>` (email alone).
  3. Email is mandatory: if `emailTrusted` is false, virtual binding never fires.

  On match, convert in place: set `oauthSub`, **`isVirtual: false`**,
  update `email`/`avatar`/`lastLoginAt`, and **preserve the local `name` AND
  `username`** (the username already equals a matched candidate; do not
  overwrite). The row id and cascaded project memberships are kept. Return.

- **Real-user take-over (existing, scoped to real rows):** if no virtual bind,
  keep today's SINGLE_USER_MODE re-bind — match by `username` (candidates) OR
  (verified) `email`, now constrained to `isVirtual = false` rows so it never
  touches a virtual row. Rebind sets only `oauthSub` (+ `email`/`avatar`/
  `lastLoginAt`); it **preserves the local `name` AND `username`** (no longer
  clobbers either).

- **No match → create a new real user** (existing insert path). This is the ONLY
  place `username` (`preferred_username ?? username ?? u_<nanoid>`) and `name`
  are taken from the upstream token.

### 4. Frontend `admin/users/index.lazy.tsx`

- Give real users an "edit name" affordance (reuse a dialog) — name-only field;
  PATCH `{ name }`.
- `VirtualUserDialog`: add an `email` input (edit + create); send `email` in the
  POST/PATCH body. Show a hint that setting the email enables auto-binding when
  the real user logs in.
- Add i18n keys to `users.json` (en + zh).

### 5. Tests

- `users.test.ts` / `users.routes.test.ts`: name edit for a real user; email
  edit + uniqueness for a virtual user; real-user email/username still rejected.
- `auth.service.test.ts`: re-login keeps local name AND local username (no
  upstream resync); virtual bind via username+email (verified) clears `isVirtual`
  and preserves the local name + username; email-only bind when the token carries
  no username claims.

## Risks

- **Behavior change**: real-user `name` no longer tracks the IdP after first
  login. This is the intended trade-off (req 1) but changes today's behavior —
  needs sign-off. Existing `upsertUser` tests assert name-from-IdP and will be
  updated.
- **Upstream rename does NOT propagate (by design)**: username and name are
  local-stable after first creation; identity is keyed on `sub`. If someone is
  renamed at the IdP, the local username/name stay as-is. This is the explicit
  intent (avoids local inconsistency / unique-constraint churn), not a bug.
- **email_verified dependency**: virtual binding requires a verified upstream
  email (email is the mandatory match key). If the IdP omits `email_verified`,
  binding never fires and a new real user is created instead (safe failure, no
  privilege escalation, but the admin must merge manually). Flagged for the
  user's IdP setup.
- **SINGLE_USER_MODE take-over preserved**: the real-row take-over keeps its
  username-OR-email match (now scoped to `isVirtual = false`) so single-user
  re-bind does not regress; only `name` clobbering is removed there too (A1).
- No migration, no data backfill.

## Scope

~6 files: `users.service.ts`, `users.routes.ts`, `auth.service.ts`,
`admin/users/index.lazy.tsx`, `users.json` (en+zh), plus three test files.
Backend logic small; most surface area is the frontend dialog + i18n + tests.

## Alternatives

- **Decision A — name sync (recommended: stop syncing).**
  - A1 (recommended): name local-owned; IdP seeds it only at first insert.
    Makes the edit meaningful and matches req 1.
  - A2: keep IdP name sync; admin name edits are overwritten on next login.
    Rejected — defeats "name editable".
- **Decision B — username sync (DECIDED: do not sync).**
  - B-final (chosen): username is upstream-originated only at brand-new-user
    creation, then locally stable. Identity continuity is via `sub`; no re-sync
    on login or bind. Upstream renames do not propagate. Simplest and avoids
    inconsistency.
  - B1 (rejected): re-sync username every login — rejected by user (upstream
    rename causes local inconsistency).
- **Decision C — binding trigger.**
  - C1 (recommended): automatic via the existing verified-email take-over path
    ("seamless") + clear `isVirtual` + preserve name. No new endpoint.
  - C2: explicit admin "Convert to real user / bind" action. More control, less
    seamless; more UI. Not requested.

## Annotations

- 2026-06-19 (user): Binding is automatic on login (C1). Auto-convert a virtual
  user to real only when BOTH the upstream `username` AND `email` match the
  virtual row ("本地匹配用户名和邮箱就可以自动转换为真实用户"). Keep the
  email-verified gate for security. Virtual rows are excluded from the
  username/email OR take-over fallback (decision D = stricter than email-only:
  require username AND email).
- 2026-06-19 (user): A1 confirmed — stop syncing the upstream name; the
  locally-edited name wins. Matching is a priority fallback chain, NOT
  username+email AND: check BOTH `preferred_username` and `username` claims
  (upstream may differ) → fall back to email → else create new. Virtual-user
  email must be editable so the email-fallback step can match. (Supersedes the
  earlier "username AND email" + exclude-virtual note above.)
- 2026-06-19 (user, final-match): matching is **username AND email**, not a
  fallback OR. Username matches against BOTH `preferred_username` and `username`
  claims; email is a mandatory match. Only when both username claims are absent
  from the token does it fall back to email-only.
- 2026-06-19 (user, final-sync): **username is NOT synced** either. Identity is
  keyed on `sub` (`oauthSub`); an existing user is matched by `sub`. Username is
  taken from upstream only at brand-new-user creation; never re-synced on login
  or on bind/take-over (matched rows keep their local username). Reason: avoid
  local inconsistency when upstream renames a user. (Reverses B1; supersedes the
  earlier "username synced from upstream" wording.)
