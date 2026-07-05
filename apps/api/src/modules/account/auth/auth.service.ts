import type { Context } from "hono";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { AuthConfig } from "@/shared/lib/app-config";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv, User } from "@/shared/lib/types";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { and, count as countFn, eq, inArray, lte, ne, or } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { openPkceVerifier, sealPkceVerifier } from "@/modules/account/auth/pkce-secret";
import { pkceChallenges, sessions } from "@/modules/account/auth/schema";
import { clearSessionCookie, readSessionId } from "@/modules/account/auth/session-cookie";
import { users } from "@/modules/account/users/schema";
import { createTotpChallenge, hasVerifiedTotp } from "@/modules/account/users/totp.service";
import { getAuthConfig, getOAuthConfig } from "@/shared/lib/app-config";
import { exchangeCodeForTokens, fetchUserInfo } from "./oidc";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// --- PKCE helpers ---

interface PkceEntry {
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

const PKCE_TTL_MS = 5 * 60 * 1000;

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
  return Buffer.from(digest).toString("base64url");
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

// --- PKCE store (SQLite-backed) ---
//
// Stateless service functions that take `db` as a parameter so callers
// thread the per-request handle through `c.get("db")`. The previous
// `initPkceStore` singleton coupled the module to a process-global
// reference — DEK rotation hot-swapped the live db without flushing
// it, leaving stale handles in pending refresh promises.

async function cleanExpiredPkce(db: AppDatabase): Promise<void> {
  const now = Date.now();
  await db.delete(pkceChallenges).where(lte(pkceChallenges.expiresAt, now)).run();
}

// --- Service functions ---

export async function createPkceChallenge(db: AppDatabase, redirectUri: string) {
  await cleanExpiredPkce(db);

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const expiresAt = Date.now() + PKCE_TTL_MS;

  await db.insert(pkceChallenges).values({
    state,
    // AEAD-sealed with a per-process key; an at-rest DB dump alone
    // cannot recover the verifier.
    codeVerifier: sealPkceVerifier(codeVerifier),
    redirectUri,
    expiresAt,
  }).run();

  const codeChallenge = await generateCodeChallenge(codeVerifier);
  return { state, codeVerifier, codeChallenge };
}

export async function consumePkceEntry(db: AppDatabase, state: string): Promise<PkceEntry | undefined> {
  await cleanExpiredPkce(db);

  const row = await db.select().from(pkceChallenges).where(eq(pkceChallenges.state, state)).get();
  if (!row)
    return undefined;

  await db.delete(pkceChallenges).where(eq(pkceChallenges.state, state)).run();

  // Defence in depth: cleanExpiredPkce ran first, but a row could still be
  // racing past its TTL. Reject explicitly rather than returning a stale entry.
  if (Date.now() > row.expiresAt)
    return undefined;

  // Unseal the stored verifier. A failure means either the row was
  // forged or the process restarted since the row was minted (the key
  // is in-memory only). Either way, treat as "missing" so the caller
  // sees a state-invalid redirect, not a 500.
  const codeVerifier = openPkceVerifier(row.codeVerifier);
  if (codeVerifier === undefined)
    return undefined;

  return {
    codeVerifier,
    redirectUri: row.redirectUri,
    expiresAt: row.expiresAt,
  };
}

// --- OIDC callback orchestration ---

/**
 * Thrown when the IdP returned an id_token that is present but cannot be
 * parsed into a usable `sub` (malformed JWT, non-string/absent `sub`
 * claim). This is an auth failure — NOT the same as a token-less pure
 * OAuth2 response. Treating an unparseable id_token as "no id_token"
 * would silently downgrade to `skipSubjectCheck`, dropping the sub
 * binding the IdP intended us to enforce.
 */
class IdTokenError extends Error {}

/**
 * Decode `sub` from the id_token JWT payload without verifying the
 * signature. We pass it to openid-client's `fetchUserInfo` as
 * `expectedSub` — the library performs the actual sub-match check
 * against the userinfo response.
 *
 * Three outcomes, deliberately distinct:
 *   - id_token genuinely absent (pure OAuth2 provider) → return `null`;
 *     the caller may skip the sub assertion.
 *   - id_token present and yields a string `sub` → return it.
 *   - id_token present but unparseable / missing a string `sub` → throw
 *     `IdTokenError`. The IdP committed to OIDC by sending a token; a
 *     broken one is an auth failure, not a reason to skip the binding.
 */
function readIdTokenSub(idToken: string | undefined): string | null {
  if (!idToken)
    return null;
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1])
    throw new IdTokenError("id_token present but not a well-formed JWT");
  let payload: { sub?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as { sub?: unknown };
  }
  catch {
    throw new IdTokenError("id_token payload is not valid JSON");
  }
  if (typeof payload.sub !== "string" || payload.sub === "")
    throw new IdTokenError("id_token payload has no usable string `sub` claim");
  return payload.sub;
}

// Test-only surface for the three-way id_token distinction (absent vs
// valid vs present-but-unparseable). Not used by runtime callers.
export const __readIdTokenSubForTests = readIdTokenSub;
export const __IdTokenErrorForTests = IdTokenError;

export interface OidcLoginInput {
  /** Full callback URL with the inbound query string mirrored onto it. */
  readonly callbackUrl: URL;
  /** The `state` echoed by the IdP (already matched against the cookie). */
  readonly state: string;
  /** PKCE verifier from the consumed challenge row (PKCE-enabled IdPs). */
  readonly codeVerifier: string | undefined;
  /** Post-login SPA redirect captured at /login time. */
  readonly redirectUri: string;
}

export type OidcLoginOutcome
  = | { readonly status: "oidc_error"; readonly detail: string }
    | { readonly status: "user_disabled" }
    | { readonly status: "totp_required"; readonly challengeId: string }
    | {
      readonly status: "logged_in";
      readonly user: typeof users.$inferSelect;
      readonly sessionId: string;
      readonly sessionMaxAge: number;
    };

/**
 * Token-exchange half of the OAuth callback: swap the code for tokens,
 * enforce the id_token `sub` binding, fetch userinfo, upsert the local
 * user, and either mint a session or defer to a TOTP challenge. The
 * route maps each outcome onto its redirect + cookie side effects.
 */
export async function completeOidcLogin(
  db: AppDatabase,
  config: Config,
  logger: Logger,
  input: OidcLoginInput,
): Promise<OidcLoginOutcome> {
  const oauth = getOAuthConfig(config);
  const authCfg = await getAuthConfig(db, config);

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      oauth,
      appConfig: config,
      callbackUrl: input.callbackUrl,
      expectedState: input.state,
      codeVerifier: oauth.pkce ? input.codeVerifier : undefined,
    });
  }
  catch (err) {
    logger.error({
      err: err instanceof Error ? err.message : String(err),
      code: (err as { code?: unknown }).code,
    }, "OAuth token exchange failed");
    return { status: "oidc_error", detail: "Token exchange failed" };
  }

  // Resolve the expected `sub` BEFORE the userinfo call so a present-
  // but-unparseable id_token fails closed as an auth error instead of
  // silently downgrading to `skipSubjectCheck`. A genuinely absent
  // id_token (pure OAuth2 IdP) yields `null` → skip is acceptable.
  let idTokenSub: string | null;
  try {
    idTokenSub = readIdTokenSub(tokens.id_token);
  }
  catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "OAuth id_token rejected");
    return { status: "oidc_error", detail: "Invalid id_token" };
  }

  let userInfo;
  try {
    // expectedSub === "" tells fetchUserInfo to skipSubjectCheck — only
    // reached when the IdP sent no id_token at all (pure OAuth2).
    userInfo = await fetchUserInfo({
      oauth,
      appConfig: config,
      accessToken: tokens.access_token,
      expectedSub: idTokenSub ?? "",
    });
  }
  catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "OAuth userinfo fetch failed");
    return { status: "oidc_error", detail: "Userinfo fetch failed" };
  }

  const user = await upsertUser(db, userInfo, authCfg, logger);

  if (user.status === "disabled") {
    logger.warn({ username: user.username }, "login denied: user is disabled");
    return { status: "user_disabled" };
  }

  // If the user has TOTP enabled, defer session creation to the verify step.
  const totpEnabled = await hasVerifiedTotp(db, user.id);
  if (totpEnabled) {
    const challengeId = await createTotpChallenge(
      db,
      user.id,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      input.redirectUri,
    );
    return { status: "totp_required", challengeId };
  }

  const sessionId = await createSession(
    db,
    user.id,
    tokens.access_token,
    tokens.refresh_token,
    authCfg.sessionMaxAge,
    tokens.expires_in,
  );

  return { status: "logged_in", user, sessionId, sessionMaxAge: authCfg.sessionMaxAge };
}

// --- User upsert ---

interface OAuthUserInfo {
  readonly sub: string;
  readonly preferred_username?: string;
  readonly username?: string;
  readonly name?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly picture?: string;
}

export async function upsertUser(
  db: AppDatabase,
  userInfo: OAuthUserInfo,
  authConfig: AuthConfig,
  logger: Logger,
): Promise<typeof users.$inferSelect> {
  const now = new Date().toISOString();
  const defaultAdmins = authConfig.defaultAdmins;
  // IdPs that don't expose a username claim (e.g. dex's password connector
  // without a configured `username` field) would otherwise leak the opaque
  // `sub` into a human-facing field. Fall back to a short random handle
  // instead — the user can still be identified by email/name in the UI.
  const username = (userInfo.preferred_username ?? userInfo.username ?? `u_${nanoid()}`).toLowerCase();
  const email = (userInfo.email ?? "").toLowerCase();
  // An unverified email is attacker-chosen at many IdPs; only match/bootstrap
  // on it when the IdP asserts it verified. Username path is left intact.
  const emailTrusted = userInfo.email_verified === true && email !== "";
  // IdPs may expose distinct `preferred_username` and `username` claims; collect
  // both (lowercased) as candidate keys when matching an existing local row.
  const usernameCandidates = [...new Set(
    [userInfo.preferred_username, userInfo.username]
      .filter((u): u is string => typeof u === "string" && u !== "")
      .map(u => u.toLowerCase()),
  )];

  const existing = await db.select().from(users).where(eq(users.oauthSub, userInfo.sub)).get();

  if (existing) {
    // Identity is keyed on `sub`. `name` and `username` are locally owned and
    // stable — never re-derived from the token, so an upstream rename cannot
    // desync the local row. Only email/avatar/lastLogin track upstream.
    await db.update(users)
      .set({
        email: userInfo.email ?? existing.email,
        avatar: userInfo.picture ?? existing.avatar,
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .run();

    return { ...existing, lastLoginAt: now, updatedAt: now };
  }

  // Bootstrap-admin assignment must be atomic with the insert. Two DEFAULT_ADMIN
  // callbacks racing on a fresh install would otherwise both observe
  // `adminCount=0` and both promote themselves — harmless (both are
  // legitimate DEFAULT_ADMIN entries) but the transaction also covers the
  // duplicate-sub race below.
  // bun:sqlite transactions are synchronous: the callback must complete
  // (and throw) before the wrapper decides COMMIT vs ROLLBACK. An async
  // callback returns a Promise that resolves *after* COMMIT has already
  // run, so subsequent awaits no longer participate in the transaction.
  // Every drizzle bun-sqlite op below is sync at runtime even though the
  // generic type pretends otherwise.
  return db.transaction((tx) => {
    // Double-check inside the tx: another concurrent callback could have just
    // created the same user. If so, fall through to update behaviour.
    const dupe = tx.select().from(users).where(eq(users.oauthSub, userInfo.sub)).get();
    if (dupe) {
      // Same as the sub-match path above: keep local name/username stable.
      tx.update(users)
        .set({
          email: userInfo.email ?? dupe.email,
          avatar: userInfo.picture ?? dupe.avatar,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, dupe.id))
        .run();
      return { ...dupe, lastLoginAt: now, updatedAt: now };
    }

    // Virtual-user binding (FEAT-038): convert a virtual row in place to this
    // real identity. Email is the mandatory match key and must be verified; a
    // username claim (preferred_username or username) must also match, EXCEPT
    // when the token carries no username claim at all, in which case the
    // verified email alone binds. The row keeps its id, local name and local
    // username — only the OAuth identity is attached and `isVirtual` cleared —
    // so its project memberships survive.
    if (emailTrusted) {
      const virtualMatch = usernameCandidates.length > 0
        ? tx.select().from(users).where(and(
            eq(users.isVirtual, true),
            eq(users.email, email),
            inArray(users.username, usernameCandidates),
          )).get()
        : tx.select().from(users).where(and(
            eq(users.isVirtual, true),
            eq(users.email, email),
          )).get();
      if (virtualMatch) {
        logger.info(
          { id: virtualMatch.id, newSub: userInfo.sub },
          "binding virtual user to real oauth identity",
        );
        const bound = {
          oauthSub: userInfo.sub,
          isVirtual: false,
          email: userInfo.email ?? virtualMatch.email,
          avatar: userInfo.picture ?? virtualMatch.avatar,
          lastLoginAt: now,
          updatedAt: now,
        };
        tx.update(users).set(bound).where(eq(users.id, virtualMatch.id)).run();
        return { ...virtualMatch, ...bound };
      }
    }

    // Real-user take-over: an existing REAL row matches by username or email
    // but not by sub. Most common trigger is the operator toggling
    // SINGLE_USER_MODE — single-user mode rewrites the row's oauth_sub to
    // the `"single-user"` sentinel, so the next OAuth login can no longer
    // resolve by sub and would otherwise crash on the username/email
    // unique constraint. Rewriting oauth_sub back to the IdP value re-binds
    // the row to the OAuth identity. Role is preserved deliberately. Scoped to
    // `isVirtual = false` so a virtual row only ever converts via the strict
    // binding path above; name and username are locally stable and preserved.
    const usernameMatch = usernameCandidates.length > 0
      ? inArray(users.username, usernameCandidates)
      : undefined;
    const conflict = emailTrusted
      ? tx.select().from(users).where(and(
          eq(users.isVirtual, false),
          usernameMatch ? or(usernameMatch, eq(users.email, email)) : eq(users.email, email),
        )).get()
      : usernameMatch
        ? tx.select().from(users).where(and(eq(users.isVirtual, false), usernameMatch)).get()
        : undefined;
    if (conflict) {
      logger.info(
        { id: conflict.id, prevSub: conflict.oauthSub, newSub: userInfo.sub },
        "rebinding existing user to new oauth_sub (identity migration)",
      );
      const rebound = {
        oauthSub: userInfo.sub,
        email: userInfo.email ?? conflict.email,
        avatar: userInfo.picture ?? conflict.avatar,
        lastLoginAt: now,
        updatedAt: now,
      };
      tx.update(users).set(rebound).where(eq(users.id, conflict.id)).run();
      return { ...conflict, ...rebound };
    }

    // Gate bootstrap on "no admin exists" rather than "no user exists" so a
    // non-admin signing up first doesn't lock out the DEFAULT_ADMIN. The
    // promotion still fires whenever a matching login lands while the
    // current admin set is empty (including after the only admin is
    // deleted / demoted), and non-admin users can sign up freely the whole
    // time.
    const adminRow = tx.select({ value: countFn() }).from(users).where(eq(users.role, "admin")).get();
    const canBootstrapAdmin = (adminRow?.value ?? 0) === 0;
    const matchesDefaultAdmin = defaultAdmins.includes(username) || (emailTrusted && defaultAdmins.includes(email));
    const isAdmin = canBootstrapAdmin && matchesDefaultAdmin;

    if (isAdmin) {
      logger.info({ username }, "user assigned admin role via DEFAULT_ADMIN (no admin existed)");
    }

    const newUser = {
      id: nanoid(),
      oauthSub: userInfo.sub,
      username,
      name: userInfo.name ?? username,
      email: userInfo.email ?? "",
      avatar: userInfo.picture ?? null,
      role: isAdmin ? "admin" as const : "user" as const,
      status: "active" as const,
      isVirtual: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(users).values(newUser).run();
    return newUser;
  });
}

// --- Single-user upsert ---

const SINGLE_USER_OAUTH_SUB = "single-user";

/**
 * Sentinel value persisted into `sessions.access_token` for sessions
 * minted by single-user login. The column is NOT NULL in the schema, so
 * we cannot store `null`. Consumers that interpret `accessToken` as an
 * OAuth bearer (e.g. `revokeToken`) MUST check for this sentinel and
 * skip the call — pushing a fake string at an IdP both fails noisily
 * and leaks the session shape.
 */
export const SINGLE_USER_ACCESS_TOKEN = "single-user:no-oauth";

export function isSingleUserSession(token: string | null | undefined): boolean {
  return token === SINGLE_USER_ACCESS_TOKEN;
}

interface SingleUserInput {
  readonly username: string;
  readonly name: string;
  readonly email: string;
}

/**
 * Resolve (or create) the row backing single-user mode. Match order:
 *   1. existing row with `oauth_sub = "single-user"` → update in place
 *   2. existing row with the configured username or email (e.g. a previous
 *      OAuth user on the same identity) → take it over, rewriting
 *      `oauth_sub` to the sentinel so future single-user logins resolve to
 *      the same row
 *   3. fresh insert
 *
 * Step 2 handles the deployment-flip case where an operator switches an
 * existing app from OAuth to single-user mode without wiping the DB.
 */
export async function upsertSingleUser(
  db: AppDatabase,
  input: SingleUserInput,
): Promise<typeof users.$inferSelect> {
  const now = new Date().toISOString();
  // Take-over fallback (step 2): match by username, and by email only when a
  // non-blank email is configured. A blank `input.email` would otherwise match
  // any legacy row with an empty email and take over an unintended account.
  const takeoverMatch = input.email === ""
    ? eq(users.username, input.username)
    : or(eq(users.username, input.username), eq(users.email, input.email));
  const existing
    = (await db.select().from(users).where(eq(users.oauthSub, SINGLE_USER_OAUTH_SUB)).get())
      ?? (await db.select().from(users).where(takeoverMatch).get());

  if (existing) {
    await db.update(users)
      .set({
        oauthSub: SINGLE_USER_OAUTH_SUB,
        username: input.username,
        name: input.name,
        email: input.email,
        role: "admin",
        status: "active",
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .run();
    return { ...existing, oauthSub: SINGLE_USER_OAUTH_SUB, username: input.username, name: input.name, email: input.email, role: "admin", status: "active", lastLoginAt: now, updatedAt: now };
  }

  const newUser = {
    id: nanoid(),
    oauthSub: SINGLE_USER_OAUTH_SUB,
    username: input.username,
    name: input.name,
    email: input.email,
    avatar: null,
    role: "admin" as const,
    status: "active" as const,
    isVirtual: false,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(users).values(newUser).run();
  return newUser;
}

// --- Session CRUD ---

export async function createSession(
  db: AppDatabase,
  userId: string,
  accessToken: string,
  refreshToken: string | undefined,
  sessionMaxAge: number,
  accessTokenExpiresIn?: number,
): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  // Ceiling: how long the application session itself lives.
  const expiresAt = new Date(Date.now() + sessionMaxAge * 1000).toISOString();
  // Independent: when the IdP access token expires and a refresh is due.
  const accessTokenExpiresAt = accessTokenExpiresIn == null
    ? null
    : new Date(Date.now() + accessTokenExpiresIn * 1000).toISOString();

  await db.insert(sessions).values({
    id,
    userId,
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt,
    accessTokenExpiresAt,
    createdAt: now,
    updatedAt: now,
  }).run();

  return id;
}

export async function getSessionWithUser(db: AppDatabase, sessionId: string) {
  // Single JOIN — every authenticated request runs this. Drizzle's `.get()`
  // returns the first row; we then split it into the two domain shapes the
  // callers expect. Halves the per-request DB round-trip count compared to
  // the previous "fetch session → fetch user" sequence.
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row)
    return undefined;
  return row;
}

async function updateSessionTokens(
  db: AppDatabase,
  sessionId: string,
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number | undefined,
) {
  const now = new Date().toISOString();
  // Refresh only moves the access-token clock; the session ceiling (expiresAt)
  // is fixed at login and must not slide.
  const accessTokenExpiresAt = expiresIn == null
    ? null
    : new Date(Date.now() + expiresIn * 1000).toISOString();

  await db.update(sessions)
    .set({
      accessToken,
      refreshToken: refreshToken ?? undefined,
      accessTokenExpiresAt,
      updatedAt: now,
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

export async function deleteSession(db: AppDatabase, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

/**
 * Revoke every session of `userId`. `exceptSessionId` (FIX-062) spares one
 * session — the wipe-import runner uses it so the operator's re-bound
 * session survives the v1-parity revocation pass.
 */
export async function deleteUserSessions(db: AppDatabase, userId: string, exceptSessionId?: string) {
  const byUser = eq(sessions.userId, userId);
  const where = exceptSessionId === undefined ? byUser : and(byUser, ne(sessions.id, exceptSessionId));
  await db.delete(sessions).where(where).run();
}

function isSessionExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function logDefaultAdmins(authConfig: AuthConfig, logger: Logger) {
  if (authConfig.defaultAdmins.length > 0) {
    logger.info(`Default admin configured: ${authConfig.defaultAdmins.join(", ")}`);
  }
}

// --- AuthProvider implementation (registered with the shared middleware) ---

/**
 * Resolves the request's session-cookie-bound user. Refreshes the OAuth
 * access token when the local session is expired but a refresh token is
 * available; otherwise tears down the session.
 */
export async function oauthSessionAuthProvider(db: AppDatabase, c: Context<AppEnv>): Promise<User | undefined> {
  const config = c.get("config");
  const sessionId = readSessionId(c);

  if (!sessionId)
    return undefined;

  const result = await getSessionWithUser(db, sessionId);
  if (!result) {
    clearSessionCookie(c, config.NODE_ENV, config.BASE_PATH);
    return undefined;
  }

  const { session, user } = result;

  if (user.status === "disabled") {
    await deleteSession(db, sessionId);
    clearSessionCookie(c, config.NODE_ENV, config.BASE_PATH);
    return undefined;
  }

  // Hard ceiling: the application session has outlived SESSION_MAX_AGE.
  if (isSessionExpired(session.expiresAt)) {
    await deleteSession(db, sessionId);
    clearSessionCookie(c, config.NODE_ENV, config.BASE_PATH);
    return undefined;
  }

  // Access token expired but the session is still within its ceiling: refresh
  // it in the background when a refresh token is available. A failed or
  // impossible refresh is NOT fatal — the user stays logged in until the
  // ceiling with a stale access token (the app does not use the access token
  // for per-request auth, only login-time userinfo and logout revocation).
  const accessTokenExpired = session.accessTokenExpiresAt != null
    && new Date(session.accessTokenExpiresAt).getTime() <= Date.now();
  if (accessTokenExpired && session.refreshToken) {
    try {
      await refreshSessionWithMutex(db, session.id, session.refreshToken, config);
    }
    catch {
      // Keep the session; the refresh is retried on the next request while the
      // session remains within its ceiling.
    }
  }

  return user;
}

// Per-session mutex for refresh-token grants. Most IdPs treat refresh tokens
// as single-use; two parallel requests on the same expired session will
// otherwise both call /token, the IdP rotates the refresh token after the
// first, the second gets `invalid_grant`, and we end up storing the second
// (failed) response over the first (succeeded). Coalesce on a single in-flight
// promise per session id.
const refreshInFlight = new Map<string, Promise<void>>();

async function refreshSessionWithMutex(
  db: AppDatabase,
  sessionId: string,
  refreshToken: string,
  config: Config,
): Promise<void> {
  const existing = refreshInFlight.get(sessionId);
  if (existing)
    return existing;

  const work = (async () => {
    const oauth = getOAuthConfig(config);
    const { refreshTokens } = await import("./oidc");
    const refreshed = await refreshTokens({ oauth, appConfig: config, refreshToken });
    await updateSessionTokens(
      db,
      sessionId,
      refreshed.access_token,
      refreshed.refresh_token,
      refreshed.expires_in,
    );
  })();
  refreshInFlight.set(sessionId, work);
  try {
    await work;
  }
  finally {
    if (refreshInFlight.get(sessionId) === work)
      refreshInFlight.delete(sessionId);
  }
}
