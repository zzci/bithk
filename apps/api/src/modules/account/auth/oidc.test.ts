import type { Config } from "@/config";
import type { OAuthConfig } from "@/shared/lib/app-config";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  __resetOidcConfigForTests,
  buildAuthorizeUrl,
  fetchUserInfo,
  pkceChallenge,
  randomPkceVerifier,
  randomState,
  refreshTokens,
  revokeToken,
} from "./oidc";

function oauthConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    clientId: "client-abc",
    clientSecret: undefined,
    authorizeUrl: "https://idp.example.com/authorize",
    tokenUrl: "https://idp.example.com/token",
    userinfoUrl: "https://idp.example.com/userinfo",
    pkce: true,
    ...overrides,
  };
}

function appConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: "test",
    OAUTH_ISSUER: undefined,
    OIDC_LOGOUT_URL: undefined,
    ...overrides,
  } as Config;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  __resetOidcConfigForTests();
  mock.restore();
  // Tests that stub `globalThis.fetch` directly must restore it, otherwise
  // the stub leaks into unrelated suites (e.g. the cron HTTP-action tests).
  globalThis.fetch = originalFetch;
});

describe("randomState / randomPkceVerifier", () => {
  test("produce unique, non-trivial values each call", () => {
    const states = new Set([randomState(), randomState(), randomState()]);
    expect(states.size).toBe(3);
    const verifiers = new Set([randomPkceVerifier(), randomPkceVerifier()]);
    expect(verifiers.size).toBe(2);
    expect(randomState().length).toBeGreaterThanOrEqual(16);
  });
});

describe("pkceChallenge", () => {
  test("is the base64url SHA-256 of the verifier (RFC 7636 S256)", async () => {
    const verifier = "test-verifier-0123456789abcdef";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(await pkceChallenge(verifier)).toBe(expected);
  });

  test("is deterministic for the same verifier", async () => {
    const v = randomPkceVerifier();
    expect(await pkceChallenge(v)).toBe(await pkceChallenge(v));
  });
});

describe("buildAuthorizeUrl", () => {
  test("sets the standard authorization-code + PKCE query params", () => {
    const url = new URL(buildAuthorizeUrl({
      oauth: oauthConfig(),
      appConfig: appConfig(),
      callbackUrl: "https://app.example.com/callback",
      state: "state-xyz",
      codeChallenge: "challenge-123",
    }));
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback");
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("omits the PKCE params when no codeChallenge is supplied", () => {
    const url = new URL(buildAuthorizeUrl({
      oauth: oauthConfig(),
      appConfig: appConfig(),
      callbackUrl: "https://app.example.com/callback",
      state: "s",
    }));
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("code_challenge_method")).toBe(false);
  });
});

describe("revokeToken (RFC 7009 path-replacement fallback)", () => {
  test("no-ops without a network call when the token URL does not end in /token", async () => {
    const fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await revokeToken({
      oauth: oauthConfig({ tokenUrl: "https://idp.example.com/oauth2/v1" }),
      appConfig: appConfig(),
      token: "tok",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("never POSTs a token to plain HTTP outside dev", async () => {
    const fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await revokeToken({
      oauth: oauthConfig({ tokenUrl: "http://idp.example.com/token" }),
      appConfig: appConfig({ NODE_ENV: "production" }),
      token: "tok",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("derives /revoke from /token and POSTs the token with client credentials", async () => {
    const fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await revokeToken({
      oauth: oauthConfig({ clientSecret: "shh" }),
      appConfig: appConfig(),
      token: "tok-123",
      hint: "refresh_token",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://idp.example.com/revoke");
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(body).toContain("token=tok-123");
    expect(body).toContain("token_type_hint=refresh_token");
    expect(body).toContain("client_id=client-abc");
    expect(body).toContain("client_secret=shh");
  });

  test("swallows a network error from the revocation endpoint (best-effort logout)", async () => {
    const fetchSpy = mock(() => Promise.reject(new Error("network down")));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(revokeToken({
      oauth: oauthConfig(),
      appConfig: appConfig(),
      token: "tok",
    })).resolves.toBeUndefined();
  });
});

// FIX-073: every oauth4webapi request must carry an AbortSignal so a hung
// IdP cannot pin the caller (the refresh grant runs from the per-request
// auth provider). Capture the `fetch` init and assert the signal is there.
describe("outbound request timeouts", () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }

  function capturingFetch(body: unknown) {
    const calls: RequestInit[] = [];
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return Promise.resolve(jsonResponse(body));
    }) as unknown as typeof fetch;
    return calls;
  }

  test("refreshTokens passes an AbortSignal to fetch", async () => {
    const calls = capturingFetch({ access_token: "new", token_type: "Bearer", expires_in: 60 });
    await refreshTokens({ oauth: oauthConfig(), appConfig: appConfig(), refreshToken: "rt" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  test("fetchUserInfo passes an AbortSignal to fetch", async () => {
    const calls = capturingFetch({ sub: "sub-1", email: "a@example.com" });
    await fetchUserInfo({ oauth: oauthConfig(), appConfig: appConfig(), accessToken: "at", expectedSub: "sub-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});
