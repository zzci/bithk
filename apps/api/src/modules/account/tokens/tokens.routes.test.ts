import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { mountRoutes, seedUser, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { tokenRoutes } from "./tokens.routes";
import { createToken } from "./tokens.service";
// Registers the chained auth provider that `authRequired` resolves through.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-tokens-routes-${Date.now()}-${testNanoid()}`);
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

const app = () => mountRoutes(db, [tokenRoutes]);

function json(cookie: string, body: unknown) {
  return {
    method: "POST",
    headers: { "Cookie": cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function seedVirtualUser(): Promise<string> {
  const id = testNanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `virtual:${id}`,
    username: `virtual-${id}`,
    name: `Virtual ${id}`,
    email: `${id}@virtual.local`,
    role: "user",
    status: "active",
    isVirtual: true,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

describe("self-service token routes", () => {
  test("creates a token, returns the plaintext exactly once with a matching prefix", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await app().request("/account/me/tokens", json(cookie, { name: "ci", expiresInDays: 30, scopes: { projects: "write" } }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.token.startsWith("bithk_pat_")).toBe(true);
    expect(data.token.startsWith(data.prefix)).toBe(true);
    expect(data.scopes).toEqual({ projects: "write" });

    // The list never returns the plaintext again.
    const list = await app().request("/account/me/tokens", { headers: { Cookie: cookie } });
    const listed = (await list.json()).data;
    expect(listed.length).toBe(1);
    expect(listed[0].token).toBeUndefined();
    expect(listed[0].prefix).toBe(data.prefix);
  });

  test("rejects an unknown scope module (422)", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await app().request("/account/me/tokens", json(cookie, { name: "x", expiresInDays: 30, scopes: { nope: "read" } }));
    expect(res.status).toBe(422);
  });

  test("rejects an out-of-range expiry (422)", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await app().request("/account/me/tokens", json(cookie, { name: "x", expiresInDays: 9999, scopes: {} }));
    expect(res.status).toBe(422);
  });

  test("lists only the caller's own tokens", async () => {
    const a = await sessionCookieFor(db, "user");
    const b = await sessionCookieFor(db, "user");
    await app().request("/account/me/tokens", json(a.cookie, { name: "a", expiresInDays: 1, scopes: {} }));
    const res = await app().request("/account/me/tokens", { headers: { Cookie: b.cookie } });
    expect((await res.json()).data.length).toBe(0);
  });

  test("revokes own token; another user's id is a 404", async () => {
    const a = await sessionCookieFor(db, "user");
    const b = await sessionCookieFor(db, "user");
    const created = await (await app().request("/account/me/tokens", json(a.cookie, { name: "a", expiresInDays: 1, scopes: {} }))).json();
    const id = created.data.id;

    // wrong owner
    const wrong = await app().request(`/account/me/tokens/${id}`, { method: "DELETE", headers: { Cookie: b.cookie } });
    expect(wrong.status).toBe(404);

    // owner
    const ok = await app().request(`/account/me/tokens/${id}`, { method: "DELETE", headers: { Cookie: a.cookie } });
    expect(ok.status).toBe(200);
    const listed = (await (await app().request("/account/me/tokens", { headers: { Cookie: a.cookie } })).json()).data;
    expect(listed[0].revokedAt).toBeTruthy();
  });

  test("a Personal Access Token cannot manage tokens (cookie-only)", async () => {
    const userId = await seedUser(db, "user");
    const { token } = await createToken(db, { userId, name: "t", scopes: { account: "write" }, expiresInDays: 30 });
    const res = await app().request("/account/me/tokens", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", expiresInDays: 1, scopes: {} }),
    });
    expect(res.status).toBe(403);
  });
});

describe("admin token routes (incl. virtual users)", () => {
  test("an admin mints a token for a virtual user", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const virtualId = await seedVirtualUser();
    const res = await app().request(`/account/users/${virtualId}/tokens`, json(cookie, { name: "bot", expiresInDays: 90, scopes: { drive: "write" } }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.token.startsWith("bithk_pat_")).toBe(true);

    const list = await app().request(`/account/users/${virtualId}/tokens`, { headers: { Cookie: cookie } });
    expect((await list.json()).data.length).toBe(1);
  });

  test("a non-admin cannot use the admin routes (403)", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const target = await seedUser(db, "user");
    const res = await app().request(`/account/users/${target}/tokens`, json(cookie, { name: "x", expiresInDays: 1, scopes: {} }));
    expect(res.status).toBe(403);
  });

  test("minting for a missing user is a 404", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request(`/account/users/nope/tokens`, json(cookie, { name: "x", expiresInDays: 1, scopes: {} }));
    expect(res.status).toBe(404);
  });
});
