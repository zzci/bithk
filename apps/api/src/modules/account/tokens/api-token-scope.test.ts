import type { TokenScopeMap } from "./scope";
import type { AppDatabase } from "@/db";
import type { ProtectedEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "@/db";
import { apiTokenScopeGuard } from "@/shared/middleware/api-token-scope";
import { authRequired } from "@/shared/middleware/auth";
import { mountRoutes, seedUser, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { apiTokens } from "./schema";
import { createToken } from "./tokens.service";
// Registers the cookie + PAT chained auth provider the guard resolves through.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-pat-scope-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

function buildApp() {
  const guardRouter = () => {
    const r = new Hono<ProtectedEnv>();
    r.use("*", apiTokenScopeGuard());
    return r;
  };
  const stubRouter = () => {
    const r = new Hono<ProtectedEnv>();
    r.use("*", authRequired);
    r.get("/projects", c => c.json({ success: true, data: [] }));
    r.post("/projects", c => c.json({ success: true, data: null }, 201));
    r.get("/drive/entries", c => c.json({ success: true, data: [] }));
    r.get("/account/me", c => c.json({ success: true, data: { id: c.get("user").id } }));
    return r;
  };
  return mountRoutes(db, [guardRouter, stubRouter]);
}

async function tokenFor(role: "admin" | "user", scopes: TokenScopeMap): Promise<string> {
  const userId = await seedUser(db, role);
  const { token } = await createToken(db, { userId, name: "t", scopes, expiresInDays: 30 });
  return token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("apiTokenScopeGuard", () => {
  test("read scope allows a GET but not a POST on the same module", async () => {
    const token = await tokenFor("user", { projects: "read" });
    const app = buildApp();
    expect((await app.request("/projects", { headers: auth(token) })).status).toBe(200);

    const post = await app.request("/projects", { method: "POST", headers: auth(token) });
    expect(post.status).toBe(403);
    expect((await post.json()).error.code).toBe("TOKEN_SCOPE_INSUFFICIENT");
  });

  test("write scope allows both read and write", async () => {
    const token = await tokenFor("user", { projects: "write" });
    const app = buildApp();
    expect((await app.request("/projects", { headers: auth(token) })).status).toBe(200);
    expect((await app.request("/projects", { method: "POST", headers: auth(token) })).status).toBe(201);
  });

  test("a module with no granted scope is rejected", async () => {
    const token = await tokenFor("user", { projects: "write" });
    const res = await buildApp().request("/drive/entries", { headers: auth(token) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("TOKEN_SCOPE_INSUFFICIENT");
  });

  test("GET /account/me is always allowed (identity probe) even with empty scope", async () => {
    const token = await tokenFor("user", {});
    const res = await buildApp().request("/account/me", { headers: auth(token) });
    expect(res.status).toBe(200);
  });

  test("an admin-owned token is still bounded by its scope", async () => {
    const token = await tokenFor("admin", {}); // admin owner, no scope granted
    const res = await buildApp().request("/projects", { headers: auth(token) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("TOKEN_SCOPE_INSUFFICIENT");
  });

  test("a revoked token falls through to a 401 (no identity)", async () => {
    const userId = await seedUser(db, "user");
    const { token, row } = await createToken(db, { userId, name: "t", scopes: { projects: "read" }, expiresInDays: 30 });
    await db.update(apiTokens).set({ revokedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.id)).run();
    const res = await buildApp().request("/projects", { headers: auth(token) });
    expect(res.status).toBe(401);
  });

  test("a cookie session is unaffected by token scope", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/drive/entries", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});
