import type { AppEnv } from "@/shared/lib/types";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  clearSessionCookie,
  cookiePath,
  RE_ANY_SESSION_COOKIE,
  readSessionId,
  sessionCookieName,
  writeSessionCookie,
} from "./session-cookie";

type Env = "production" | "development" | "test";

function appThatWrites(env: Env, basePath: string, sid = "sid-123", maxAge = 3600) {
  const app = new Hono<AppEnv>();
  app.get("/set", (c) => {
    writeSessionCookie(c, env, basePath, sid, maxAge);
    return c.body(null, 204);
  });
  app.get("/clear", (c) => {
    clearSessionCookie(c, env, basePath);
    return c.body(null, 204);
  });
  return app;
}

describe("sessionCookieName", () => {
  test("uses the __Secure- prefix in production only", () => {
    expect(sessionCookieName("production")).toBe("__Secure-session_id");
    expect(sessionCookieName("development")).toBe("session_id");
    expect(sessionCookieName("test")).toBe("session_id");
  });
});

describe("cookiePath", () => {
  test("normalises empty BASE_PATH to /", () => {
    expect(cookiePath("")).toBe("/");
  });
  test("keeps a non-empty BASE_PATH", () => {
    expect(cookiePath("/foo")).toBe("/foo");
  });
});

describe("writeSessionCookie", () => {
  test("dev cookie is HttpOnly + SameSite=Lax + scoped path, NOT Secure", async () => {
    const res = await appThatWrites("development", "").request("/set");
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain("session_id=sid-123");
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Path=/");
    expect(sc).not.toContain("Secure");
    expect(sc).not.toContain("__Secure-");
  });

  test("production cookie is __Secure- prefixed and Secure", async () => {
    const res = await appThatWrites("production", "/app").request("/set");
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain("__Secure-session_id=sid-123");
    expect(sc).toContain("Secure");
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("Path=/app");
  });
});

describe("readSessionId", () => {
  test("reads the dev cookie name", async () => {
    const app = new Hono<AppEnv>();
    app.get("/read", c => c.text(readSessionId(c) ?? "none"));
    const res = await app.request("/read", { headers: { cookie: "session_id=abc" } });
    expect(await res.text()).toBe("abc");
  });

  test("reads the prod-prefixed cookie name", async () => {
    const app = new Hono<AppEnv>();
    app.get("/read", c => c.text(readSessionId(c) ?? "none"));
    const res = await app.request("/read", { headers: { cookie: "__Secure-session_id=xyz" } });
    expect(await res.text()).toBe("xyz");
  });

  test("returns undefined when neither variant is present", async () => {
    const app = new Hono<AppEnv>();
    app.get("/read", c => c.text(readSessionId(c) ?? "none"));
    const res = await app.request("/read", { headers: { cookie: "other=1" } });
    expect(await res.text()).toBe("none");
  });
});

describe("clearSessionCookie", () => {
  test("clears the dev variant with an expiry", async () => {
    const res = await appThatWrites("development", "").request("/clear");
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain("session_id=");
    expect(sc).toContain("Max-Age=0");
  });

  test("production clears the Secure-prefixed variant (does not throw)", async () => {
    const res = await appThatWrites("production", "/app").request("/clear");
    expect(res.status).toBe(204);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain("session_id=");
  });
});

describe("RE_ANY_SESSION_COOKIE", () => {
  test("matches both the dev and prod cookie names in a raw Cookie header", () => {
    expect(RE_ANY_SESSION_COOKIE.test("session_id=abc")).toBe(true);
    expect(RE_ANY_SESSION_COOKIE.test("__Secure-session_id=abc")).toBe(true);
    expect(RE_ANY_SESSION_COOKIE.test("foo=1; session_id=abc")).toBe(true);
    expect(RE_ANY_SESSION_COOKIE.test("foo=1; __Secure-session_id=abc")).toBe(true);
  });

  test("does not match an unrelated cookie", () => {
    expect(RE_ANY_SESSION_COOKIE.test("not_session_id=abc")).toBe(false);
    expect(RE_ANY_SESSION_COOKIE.test("csrf=abc")).toBe(false);
  });
});
