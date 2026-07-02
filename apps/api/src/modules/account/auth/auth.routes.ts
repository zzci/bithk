import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { clearSessionCookie, cookiePath, readSessionId, writeSessionCookie } from "@/modules/account/auth/session-cookie";
import {
  consumeTotpChallenge,
  createTotpChallenge,
  verifyTotpCode,
} from "@/modules/account/users/totp.service";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { deriveOrigin, getAuthConfig, getOAuthConfig, getOidcLogoutUrl, getSingleUserConfig, isOAuthConfigured, isSingleUserMode } from "@/shared/lib/app-config";
import { getClientIp } from "@/shared/lib/client-ip";
import { describeRoute, errorJson, jsonRequestBody, okJson } from "@/shared/lib/openapi";
import {
  completeOidcLogin,
  consumePkceEntry,
  createPkceChallenge,
  createSession,
  deleteSession,
  getSessionWithUser,
  isSingleUserSession,
  SINGLE_USER_ACCESS_TOKEN,
  upsertSingleUser,
} from "./auth.service";
import {
  checkAuthRateLimit,
  clearSingleUserFailures,
  isSingleUserLocked,
  recordSingleUserFailure,
} from "./lockout.service";
import { buildAuthorizeUrl, revokeToken } from "./oidc";
import { verifyPassword } from "./password";

// eslint-disable-next-line no-control-regex
const RE_CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

// In production we use `__Secure-` (not `__Host-`) for auxiliary cookies so
// multiple instances on one origin under different `BASE_PATH`s don't clobber
// each other's cookies via the forced `Path=/`. Dev uses the plain name
// because `__Secure-` requires HTTPS.
const TOTP_PENDING_COOKIE_PROD = "__Secure-totp_pending";
const TOTP_PENDING_COOKIE_DEV = "totp_pending";

function totpPendingCookieName(env: "production" | "development" | "test"): string {
  return env === "production" ? TOTP_PENDING_COOKIE_PROD : TOTP_PENDING_COOKIE_DEV;
}

// Browser-side `state` binding — closes the gap where PKCE alone proves
// "the same browser holds the verifier" but does NOT prove "the same
// browser kicked the flow off". Issued at /login, asserted at /callback.
const OAUTH_STATE_COOKIE_PROD = "__Secure-oauth_state";
const OAUTH_STATE_COOKIE_DEV = "oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function oauthStateCookieName(env: "production" | "development" | "test"): string {
  return env === "production" ? OAUTH_STATE_COOKIE_PROD : OAUTH_STATE_COOKIE_DEV;
}

/**
 * Rate-limit key. Defers to `getClientIp` so `TRUST_PROXY=true` deployments
 * key per-end-user IP (X-Real-IP / right-most X-Forwarded-For) instead of
 * collapsing the entire tenant onto the proxy's peer IP.
 */
function rateLimitKey(c: Context<AppEnv>): string {
  return getClientIp(c, c.get("config"));
}

// Collapse `/` and `\` runs that browsers may treat as protocol prefixes
// (`/\evil.com`, `\\evil.com`) before the prefix check.
const RE_LEADING_SLASHES = /^[/\\]+/;
const RE_BACKSLASH = /\\/g;

/**
 * Build a redirect to the SPA's shared `/error` page. Every auth failure
 * path goes through here so the user always sees the same Card-based
 * error layout. The frontend reads `?code` and `?detail` and renders an
 * i18n message; the Retry button uses the browser's own history (no
 * server-side "back" pointer needed). `detail` is truncated to defend
 * against runaway IdP error_description payloads.
 */
type LoginErrorCode = "oauth_not_configured" | "oauth_state_invalid" | "oidc_error" | "user_disabled" | "single_user_mode_active";

function buildLoginErrorUrl(basePath: string, code: LoginErrorCode, detail?: string): string {
  const url = new URL(`http://placeholder${basePath}/error`);
  url.searchParams.set("code", code);
  if (detail) {
    url.searchParams.set("detail", detail.slice(0, 200));
  }
  return `${url.pathname}${url.search}`;
}

function sanitizeRedirect(raw: string, basePath: string): string {
  // Reject:
  //  - empty / non-`/` strings (relative paths could resolve to current host
  //    + path which is what we want, but we keep the gate strict to avoid
  //    accidental ".." or scheme-relative escapes)
  //  - protocol-relative `//evil.com` / `/\evil.com` / `\\evil.com`
  //  - colon-bearing pseudo-protocols (`/javascript:alert(1)` — browsers
  //    technically reject as a navigation target, but defence in depth)
  //  - anything outside the application's BASE_PATH so a tampered redirect
  //    cannot bounce a logged-in user into an admin route their session is
  //    valid for but the UI never showed them
  const fallback = `${basePath}/`;
  if (typeof raw !== "string" || raw.length === 0)
    return fallback;
  // Re-shape backslashes into slashes so the prefix check cannot be evaded
  // via `\foo` (some browsers normalise this to `/foo` mid-flight).
  const normalised = raw.replace(RE_BACKSLASH, "/");
  // Strip leading slash runs and re-prefix with a single `/` to defeat
  // protocol-relative attempts.
  const stripped = normalised.replace(RE_LEADING_SLASHES, "");
  const candidate = `/${stripped}`;
  if (candidate.includes(":"))
    return fallback;
  // Must live under our BASE_PATH (or be exactly the base). Reject paths
  // pointing at the API itself; the SPA never redirects callers there.
  if (candidate !== basePath && !candidate.startsWith(`${basePath}/`))
    return fallback;
  if (candidate.startsWith(`${basePath}/api/`) || candidate === `${basePath}/api`)
    return fallback;
  return candidate;
}

const redirect302 = { description: "Redirect (to the IdP, the SPA, or the shared error page)" };

export function authRoutes() {
  const router = new Hono<AppEnv>();

  // GET /account/auth/login — initiate OAuth flow (with optional PKCE)
  router.get(
    "/account/auth/login",
    describeRoute({
      tags: ["account"],
      summary: "Begin the OAuth login flow",
      responses: { 302: redirect302, 429: { description: "Rate limited", ...errorJson } },
    }),
    async (c) => {
      {
        const retryAfter = checkAuthRateLimit(rateLimitKey(c), c.get("config"));
        if (retryAfter > 0) {
          c.header("Retry-After", String(retryAfter));
          return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
        }
      }
      const config = c.get("config");
      const base = config.BASE_PATH;
      // Single-user mode short-circuits the OAuth dance. The SPA renders the
      // local username/password form instead, so an OAuth-initiated login is
      // an explicit operator misconfiguration — surface it loudly.
      if (isSingleUserMode(config)) {
        return c.redirect(buildLoginErrorUrl(base, "single_user_mode_active"), 302);
      }
      // OAuth is a hard requirement: refuse to start the dance when any of
      // OAUTH_CLIENT_ID / OAUTH_*_URL is missing, instead of letting
      // getOAuthConfig throw into Hono's default 500 handler. Bouncing back
      // to /login with a banner-friendly error code keeps the user in the
      // SPA flow.
      if (!isOAuthConfigured(config)) {
        return c.redirect(buildLoginErrorUrl(base, "oauth_not_configured"), 302);
      }
      const oauth = getOAuthConfig(config);
      const callbackUrl = `${deriveOrigin(c.req.raw, config)}${base}/api/account/auth/callback`;
      const redirectUri = sanitizeRedirect(c.req.query("redirect") ?? `${base}/overview`, base);

      const { state, codeChallenge } = await createPkceChallenge(c.get("db"), redirectUri);
      const authorizeUrl = buildAuthorizeUrl({
        oauth,
        appConfig: config,
        callbackUrl,
        state,
        codeChallenge: oauth.pkce ? await codeChallenge : undefined,
      });

      // Bind `state` to this browser via an httpOnly cookie. /callback rejects
      // any callback whose query state does not match the cookie — closes the
      // session-fixation hole that PKCE alone leaves open.
      setCookie(c, oauthStateCookieName(config.NODE_ENV), state, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "Lax",
        path: cookiePath(base),
        maxAge: OAUTH_STATE_TTL_SECONDS,
      });

      return c.redirect(authorizeUrl, 302);
    },
  );

  // GET /account/auth/callback — OAuth callback
  router.get(
    "/account/auth/callback",
    describeRoute({
      tags: ["account"],
      summary: "OAuth callback — completes login or steps up to TOTP",
      responses: { 302: redirect302, 429: { description: "Rate limited", ...errorJson } },
    }),
    async (c) => {
      {
        const retryAfter = checkAuthRateLimit(rateLimitKey(c), c.get("config"));
        if (retryAfter > 0) {
          c.header("Retry-After", String(retryAfter));
          return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
        }
      }
      const db = c.get("db");
      const config = c.get("config");
      const logger = c.get("logger");
      const base = config.BASE_PATH;
      // Same guard as /login: if the OAuth config was wiped between the user
      // bouncing out to the IdP and bouncing back, surface a real error
      // instead of letting getOAuthConfig throw into a 500.
      if (!isOAuthConfigured(config)) {
        return c.redirect(buildLoginErrorUrl(base, "oauth_not_configured"), 302);
      }

      const code = c.req.query("code");
      const state = c.req.query("state");
      const error = c.req.query("error");

      if (error) {
        const rawDesc = c.req.query("error_description") ?? error;
        const desc = rawDesc.replace(RE_CONTROL_CHARS, "").slice(0, 200);
        logger.warn({ error, desc }, "OAuth authorization error");
        await auditFromCtx(c, {
          actorId: "system",
          actorName: "system",
          action: "auth.login_failed",
          resourceType: "auth",
          resourceId: "",
          resourceName: "oauth",
          detail: { error, description: desc },
          result: "failure",
        });
        return c.redirect(buildLoginErrorUrl(base, "oidc_error", desc), 302);
      }

      if (!code || !state) {
        return c.redirect(buildLoginErrorUrl(base, "oauth_state_invalid"), 302);
      }

      // `state` must match the cookie planted at /login. A reload after the
      // browser closed (or a CSRF-style cross-browser callback delivery) loses
      // the cookie — reject explicitly so the user re-initiates login.
      const cookieName = oauthStateCookieName(config.NODE_ENV);
      const cookieState = getCookie(c, cookieName);
      deleteCookie(c, cookieName, {
        path: cookiePath(base),
        secure: config.NODE_ENV === "production",
      });
      if (!cookieState || cookieState !== state) {
        return c.redirect(buildLoginErrorUrl(base, "oauth_state_invalid"), 302);
      }

      const pkceEntry = await consumePkceEntry(c.get("db"), state);
      if (!pkceEntry) {
        return c.redirect(buildLoginErrorUrl(base, "oauth_state_invalid"), 302);
      }

      const origin = deriveOrigin(c.req.raw, config);
      const callbackUrl = new URL(`${origin}${base}/api/account/auth/callback`);
      // Mirror the inbound query string so openid-client can validate the
      // full set of response parameters in a single pass.
      for (const [k, v] of new URL(c.req.url).searchParams)
        callbackUrl.searchParams.append(k, v);

      const outcome = await completeOidcLogin(db, config, logger, {
        callbackUrl,
        state,
        codeVerifier: pkceEntry.codeVerifier,
        redirectUri: pkceEntry.redirectUri,
      });

      if (outcome.status === "oidc_error") {
        return c.redirect(buildLoginErrorUrl(base, "oidc_error", outcome.detail), 302);
      }
      if (outcome.status === "user_disabled") {
        return c.redirect(buildLoginErrorUrl(base, "user_disabled"), 302);
      }
      if (outcome.status === "totp_required") {
        setCookie(c, totpPendingCookieName(config.NODE_ENV), outcome.challengeId, {
          httpOnly: true,
          secure: config.NODE_ENV === "production",
          sameSite: "Lax",
          path: cookiePath(base),
          maxAge: 300,
        });
        return c.redirect(`${base}/totp-verify`, 302);
      }

      writeSessionCookie(c, config.NODE_ENV, config.BASE_PATH, outcome.sessionId, outcome.sessionMaxAge);

      await auditFromCtx(c, {
        actorId: outcome.user.id,
        actorName: outcome.user.name,
        action: "auth.login",
        resourceType: "user",
        resourceId: outcome.user.id,
        resourceName: outcome.user.username,
        result: "success",
      });

      return c.redirect(sanitizeRedirect(pkceEntry.redirectUri, base), 302);
    },
  );

  // POST /account/auth/logout — destroy session
  router.post(
    "/account/auth/logout",
    describeRoute({
      tags: ["account"],
      summary: "Destroy the session and revoke OAuth tokens",
      responses: { 200: okJson(z.null()) },
    }),
    async (c) => {
      const db = c.get("db");
      const config = c.get("config");
      const sessionId = readSessionId(c);

      let logoutUser: { id: string; name: string; username: string } | undefined;
      if (sessionId) {
        const result = await getSessionWithUser(db, sessionId);
        if (result) {
          logoutUser = result.user;
          // Best-effort OAuth token revocation. Sessions minted by the
          // single-user flow carry the SINGLE_USER_ACCESS_TOKEN sentinel,
          // not a real IdP bearer — skip the revocation call entirely in
          // that case, both to avoid noise at the IdP and to keep the
          // sentinel value out of any audit / metrics surface the
          // openid-client library emits. openid-client picks the
          // discovered revocation_endpoint (with RFC 7009 path-replacement
          // fallback) so we don't have to guess the URL.
          if (!isSingleUserSession(result.session.accessToken)) {
            try {
              const oauth = getOAuthConfig(config);
              await revokeToken({ oauth, appConfig: config, token: result.session.accessToken, hint: "access_token" });
              if (result.session.refreshToken) {
                await revokeToken({ oauth, appConfig: config, token: result.session.refreshToken, hint: "refresh_token" });
              }
            }
            catch { /* non-critical */ }
          }
        }
        await deleteSession(db, sessionId);
      }

      clearSessionCookie(c, config.NODE_ENV, config.BASE_PATH);

      if (logoutUser) {
        await auditFromCtx(c, {
          actorId: logoutUser.id,
          actorName: logoutUser.name,
          action: "auth.logout",
          resourceType: "user",
          resourceId: logoutUser.id,
          resourceName: logoutUser.username,
          result: "success",
        });
      }

      return c.json({ success: true, data: null });
    },
  );

  // GET /account/auth/logout-url — public, returns OIDC logout URL for account switching
  router.get(
    "/account/auth/logout-url",
    describeRoute({
      tags: ["account"],
      summary: "OIDC end-session URL for account switching",
      responses: { 200: okJson(z.object({ url: z.string().nullable() })) },
    }),
    async (c) => {
      const config = c.get("config");
      const url = getOidcLogoutUrl(config);
      return c.json({ success: true, data: { url } });
    },
  );

  // GET /account/auth/mode — public, surfaces which login UI to render
  // GET /account/auth/mode — anonymous; tells the SPA which login form
  // to render (OAuth button vs. single-user form). The fields below are
  // intentionally minimal because anonymous responses are observable
  // posture data:
  //   - `mode` is required so the SPA can render the right form
  //     without an extra round-trip on every login attempt.
  //   - `oauthConfigured` is required to decide whether the OAuth
  //     button should be rendered at all (a misconfigured deploy
  //     should not leave a dead button on the login page).
  // Brute-force exposure on the single-user surface is neutralised by
  // the per-username lockout in `/account/auth/login-local` — the
  // mode-leak is no longer an actionable triage signal for an attacker.
  router.get(
    "/account/auth/mode",
    describeRoute({
      tags: ["account"],
      summary: "Which login UI to render (oauth vs single-user)",
      responses: { 200: okJson(z.object({ mode: z.enum(["single-user", "oauth"]), oauthConfigured: z.boolean() })) },
    }),
    (c) => {
      const config = c.get("config");
      return c.json({
        success: true,
        data: {
          mode: isSingleUserMode(config) ? "single-user" : "oauth",
          oauthConfigured: isOAuthConfigured(config),
        },
      });
    },
  );

  // POST /account/auth/login-local — public, env-credential login (single-user mode)
  router.post(
    "/account/auth/login-local",
    describeRoute({
      tags: ["account"],
      summary: "Single-user (env-credential) login",
      requestBody: jsonRequestBody(z.object({ username: z.string(), password: z.string() })),
      responses: { 200: okJson(z.object({ id: z.string(), username: z.string(), name: z.string() })), 400: { description: "Invalid body or credentials", ...errorJson }, 401: { description: "Invalid credentials", ...errorJson }, 404: { description: "Single-user mode disabled", ...errorJson }, 429: { description: "Rate limited or account locked", ...errorJson } },
    }),
    async (c) => {
      {
        const retryAfter = checkAuthRateLimit(rateLimitKey(c), c.get("config"));
        if (retryAfter > 0) {
          c.header("Retry-After", String(retryAfter));
          return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
        }
      }

      const db = c.get("db");
      const config = c.get("config");
      const logger = c.get("logger");

      if (!isSingleUserMode(config)) {
        return c.json({ success: false, error: { code: "SINGLE_USER_DISABLED", message: "Single-user mode is not enabled" } }, 404);
      }

      let body: { username?: unknown; password?: unknown };
      try {
        body = await c.req.json();
      }
      catch {
        return c.json({ success: false, error: { code: "INVALID_BODY", message: "Invalid JSON body" } }, 400);
      }

      const usernameRaw = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!usernameRaw || !password) {
        return c.json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } }, 400);
      }

      const single = getSingleUserConfig(config);

      // Per-username lockout (proxy-rotation-resistant). Checked against the
      // configured account *and* the submitted account so the attacker cannot
      // probe past the lock by varying the username field on each request.
      for (const candidate of [single.username, usernameRaw]) {
        const lock = await isSingleUserLocked(db, candidate);
        if (lock.locked) {
          c.header("Retry-After", String(lock.retryAfterSeconds));
          return c.json(
            { success: false, error: { code: "ACCOUNT_LOCKED", message: "Account temporarily locked. Try again later." } },
            429,
          );
        }
      }

      const usernameMatches = usernameRaw.toLowerCase() === single.username;

      // Always run the password verify even when the username does not match —
      // keeps the comparison time roughly constant and avoids leaking which of
      // the two halves was wrong.
      let passwordMatches: boolean;
      try {
        passwordMatches = await verifyPassword(password, single.passwordHash);
      }
      catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "single-user password verify failed");
        passwordMatches = false;
      }

      if (!usernameMatches || !passwordMatches) {
      // Record against the configured account regardless of which half failed;
      // an attacker spraying random usernames against a single real account
      // should hit the same shared lock as a direct attack.
        await recordSingleUserFailure(db, single.username);
        await auditFromCtx(c, {
          actorId: "system",
          actorName: "system",
          action: "auth.login_failed",
          resourceType: "auth",
          resourceId: "",
          resourceName: "single-user",
          detail: { username: usernameRaw.slice(0, 64) },
          result: "failure",
        });
        return c.json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } }, 401);
      }

      await clearSingleUserFailures(db, single.username);

      const user = await upsertSingleUser(db, {
        username: single.username,
        name: single.name,
        email: single.email,
      });

      const authCfg = await getAuthConfig(db, config);
      const sessionId = await createSession(
        db,
        user.id,
        SINGLE_USER_ACCESS_TOKEN,
        undefined,
        authCfg.sessionMaxAge,
        undefined,
      );
      writeSessionCookie(c, config.NODE_ENV, config.BASE_PATH, sessionId, authCfg.sessionMaxAge);

      await auditFromCtx(c, {
        actorId: user.id,
        actorName: user.name,
        action: "auth.login",
        resourceType: "user",
        resourceId: user.id,
        resourceName: user.username,
        detail: { mode: "single-user" },
        result: "success",
      });

      return c.json({ success: true, data: { id: user.id, username: user.username, name: user.name } });
    },
  );

  // POST /account/auth/totp/verify — verify TOTP during login
  router.post(
    "/account/auth/totp/verify",
    describeRoute({
      tags: ["account"],
      summary: "Verify a TOTP challenge to complete login",
      requestBody: jsonRequestBody(z.object({ code: z.string().length(6) })),
      responses: { 200: okJson(z.object({ redirect: z.string() })), 400: { description: "Invalid/expired challenge or code", ...errorJson }, 429: { description: "Rate limited or user locked", ...errorJson } },
    }),
    async (c) => {
      {
        const retryAfter = checkAuthRateLimit(rateLimitKey(c), c.get("config"));
        if (retryAfter > 0) {
          c.header("Retry-After", String(retryAfter));
          return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
        }
      }
      const db = c.get("db");
      const config = c.get("config");

      const challengeId = getCookie(c, totpPendingCookieName(config.NODE_ENV))
        ?? getCookie(c, TOTP_PENDING_COOKIE_DEV);
      if (!challengeId) {
        return c.json({ success: false, error: { code: "NO_PENDING_TOTP", message: "No pending TOTP challenge" } }, 400);
      }

      let body: { code?: unknown };
      try {
        body = await c.req.json();
      }
      catch {
        return c.json({ success: false, error: { code: "INVALID_BODY", message: "Invalid JSON body" } }, 400);
      }
      const code = typeof body.code === "string" ? body.code : "";
      if (code.length !== 6) {
        return c.json({ success: false, error: { code: "INVALID_CODE", message: "Code must be 6 digits" } }, 400);
      }

      const challenge = await consumeTotpChallenge(db, challengeId);
      if (!challenge) {
        deleteCookie(c, totpPendingCookieName(config.NODE_ENV), {
          path: cookiePath(config.BASE_PATH),
          secure: config.NODE_ENV === "production",
        });
        return c.json({ success: false, error: { code: "EXPIRED_CHALLENGE", message: "TOTP challenge expired, please login again" } }, 400);
      }

      // Per-user lockout precedes verifyTotpCode so 5 wrong codes from rotating
      // IPs still trip the gate (per-IP limiter alone misses that vector).
      const { isTotpUserLocked } = await import("@/modules/account/users/totp.service");
      const lockState = await isTotpUserLocked(db, challenge.userId);
      if (lockState.locked) {
        deleteCookie(c, totpPendingCookieName(config.NODE_ENV), {
          path: cookiePath(config.BASE_PATH),
          secure: config.NODE_ENV === "production",
        });
        c.header("Retry-After", String(lockState.retryAfterSeconds));
        return c.json(
          { success: false, error: { code: "TOTP_USER_LOCKED", message: "Too many failed attempts. Restart login after the lockout expires." } },
          429,
        );
      }

      const ok = await verifyTotpCode(db, challenge.userId, code);
      if (!ok) {
      // After verifyTotpCode flipped the failure counter, re-check whether
      // this attempt tipped the user over the threshold so we surface the
      // 429 immediately instead of inviting another guess.
        const stateAfter = await isTotpUserLocked(db, challenge.userId);
        if (stateAfter.locked) {
          deleteCookie(c, totpPendingCookieName(config.NODE_ENV), {
            path: cookiePath(config.BASE_PATH),
            secure: config.NODE_ENV === "production",
          });
          c.header("Retry-After", String(stateAfter.retryAfterSeconds));
          return c.json(
            { success: false, error: { code: "TOTP_USER_LOCKED", message: "Too many failed attempts. Restart login after the lockout expires." } },
            429,
          );
        }
        // Re-create challenge so user can retry
        const newId = await createTotpChallenge(
          db,
          challenge.userId,
          challenge.accessToken,
          challenge.refreshToken ?? undefined,
          challenge.expiresIn ?? undefined,
          challenge.redirectUri,
        );
        setCookie(c, totpPendingCookieName(config.NODE_ENV), newId, {
          httpOnly: true,
          secure: config.NODE_ENV === "production",
          sameSite: "Lax",
          path: cookiePath(config.BASE_PATH),
          maxAge: 300,
        });
        return c.json({ success: false, error: { code: "TOTP_VERIFY_FAILED", message: "Invalid TOTP code" } }, 400);
      }

      deleteCookie(c, totpPendingCookieName(config.NODE_ENV), {
        path: cookiePath(config.BASE_PATH),
        secure: config.NODE_ENV === "production",
      });

      const authCfg = await getAuthConfig(db, config);
      const sessionId = await createSession(
        db,
        challenge.userId,
        challenge.accessToken,
        challenge.refreshToken ?? undefined,
        authCfg.sessionMaxAge,
        challenge.expiresIn ?? undefined,
      );

      writeSessionCookie(c, config.NODE_ENV, config.BASE_PATH, sessionId, authCfg.sessionMaxAge);

      // Resolve the human name for the audit row — challenge.userId is just
      // the opaque id, which makes the audit log unreadable in the UI.
      const { getUserById } = await import("@/modules/account/users/users.service");
      const challengeUser = await getUserById(db, challenge.userId);
      await auditFromCtx(c, {
        actorId: challenge.userId,
        actorName: challengeUser?.name ?? challenge.userId,
        action: "auth.login",
        resourceType: "user",
        resourceId: challenge.userId,
        resourceName: "totp-verified",
        result: "success",
      });

      return c.json({ success: true, data: { redirect: sanitizeRedirect(challenge.redirectUri, config.BASE_PATH) } });
    },
  );

  return router;
}
