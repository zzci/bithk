import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { AuthConfig } from "@/shared/lib/app-config";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createVirtualUser } from "@/modules/account/users/users.service";
import { __IdTokenErrorForTests, __readIdTokenSubForTests, createSession, oauthSessionAuthProvider, upsertSingleUser, upsertUser } from "./auth.service";
import { sessions } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

function authConfig(defaultAdmins: readonly string[]): AuthConfig {
  return {
    sessionMaxAge: 86400,
    defaultAdmins,
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-auth-service-${Date.now()}-${nanoid()}`);
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

describe("upsertUser DEFAULT_ADMIN bootstrap", () => {
  test("assigns admin only to the first matching user", async () => {
    const first = await upsertUser(
      db,
      { sub: "sub-admin", preferred_username: "admin", email: "admin@example.com", email_verified: true },
      authConfig(["admin@example.com", "second@example.com"]),
      logger,
    );

    const second = await upsertUser(
      db,
      { sub: "sub-second", preferred_username: "second", email: "second@example.com", email_verified: true },
      authConfig(["admin@example.com", "second@example.com"]),
      logger,
    );

    expect(first.role).toBe("admin");
    expect(second.role).toBe("user");
  });

  test("does not promote an existing user after DEFAULT_ADMIN changes", async () => {
    const created = await upsertUser(
      db,
      { sub: "sub-user", preferred_username: "alice", email: "alice@example.com" },
      authConfig([]),
      logger,
    );

    const updated = await upsertUser(
      db,
      { sub: "sub-user", preferred_username: "alice", email: "alice@example.com" },
      authConfig(["alice@example.com"]),
      logger,
    );

    const row = await db.select().from(users).where(eq(users.id, created.id)).get();

    expect(created.role).toBe("user");
    expect(updated.role).toBe("user");
    expect(row?.role).toBe("user");
  });

  test("promotes DEFAULT_ADMIN even when a non-admin user signed up first", async () => {
    // Bootstrap is gated on "no admin exists", not "no user exists", so a
    // regular employee logging in before the admin must not lock the admin
    // out of auto-promotion.
    const first = await upsertUser(
      db,
      { sub: "sub-bob", preferred_username: "bob", email: "bob@example.com" },
      authConfig(["admin@example.com"]),
      logger,
    );

    const admin = await upsertUser(
      db,
      { sub: "sub-admin", preferred_username: "admin", email: "admin@example.com", email_verified: true },
      authConfig(["admin@example.com"]),
      logger,
    );

    expect(first.role).toBe("user");
    expect(admin.role).toBe("admin");
  });

  test("upsertUser rebinds an existing single-user row when OAuth comes back", async () => {
    // 1. OAuth bootstrap admin
    const first = await upsertUser(
      db,
      { sub: "google-12345", preferred_username: "admin", email: "admin@example.com", email_verified: true, name: "Admin" },
      authConfig(["admin@example.com"]),
      logger,
    );
    expect(first.role).toBe("admin");
    expect(first.oauthSub).toBe("google-12345");

    // 2. Operator flips SINGLE_USER_MODE on — single-user takes over the row.
    const single = await upsertSingleUser(db, {
      username: "admin",
      name: "Admin",
      email: "admin@example.com",
    });
    expect(single.id).toBe(first.id);
    expect(single.oauthSub).toBe("single-user");

    // 3. Operator flips SINGLE_USER_MODE off — same email lands via OAuth.
    // The row must rebind to the IdP sub instead of crashing on the email
    // unique index.
    const reclaimed = await upsertUser(
      db,
      { sub: "google-12345", preferred_username: "admin", email: "admin@example.com", name: "Admin" },
      authConfig(["admin@example.com"]),
      logger,
    );
    expect(reclaimed.id).toBe(first.id);
    expect(reclaimed.oauthSub).toBe("google-12345");
    expect(reclaimed.role).toBe("admin");

    const rows = await db.select().from(users).all();
    expect(rows.length).toBe(1);
  });

  test("upsertUser takes over a row by username/email when the IdP sub changes", async () => {
    // E.g. operator moved from one IdP to another. The original user row
    // had a Google sub; the new login carries an Okta sub.
    const original = await upsertUser(
      db,
      { sub: "google-aaa", preferred_username: "alice", email: "alice@example.com" },
      authConfig([]),
      logger,
    );

    const migrated = await upsertUser(
      db,
      { sub: "okta-bbb", preferred_username: "alice", email: "alice@example.com" },
      authConfig([]),
      logger,
    );

    expect(migrated.id).toBe(original.id);
    expect(migrated.oauthSub).toBe("okta-bbb");

    const rows = await db.select().from(users).all();
    expect(rows.length).toBe(1);
  });

  test("upsertSingleUser takes over an existing user with the same username/email", async () => {
    // Simulate an existing OAuth-bootstrapped user (e.g. operator flipped
    // SINGLE_USER_MODE on an existing deployment without wiping the DB).
    const existing = await upsertUser(
      db,
      { sub: "google-12345", preferred_username: "admin", email: "admin@example.com", name: "Existing Admin" },
      authConfig([]),
      logger,
    );

    const single = await upsertSingleUser(db, {
      username: "admin",
      name: "Admin",
      email: "admin@example.com",
    });

    expect(single.id).toBe(existing.id);
    expect(single.oauthSub).toBe("single-user");
    expect(single.role).toBe("admin");

    // Subsequent logins resolve to the same row via the sentinel oauth_sub.
    const again = await upsertSingleUser(db, {
      username: "admin",
      name: "Admin",
      email: "admin@example.com",
    });
    expect(again.id).toBe(existing.id);

    const rows = await db.select().from(users).all();
    expect(rows.length).toBe(1);
  });

  test("upsertSingleUser inserts an admin row and keeps the same id on rename", async () => {
    const first = await upsertSingleUser(db, {
      username: "owner",
      name: "Owner",
      email: "owner@local",
    });
    expect(first.role).toBe("admin");
    expect(first.oauthSub).toBe("single-user");

    const renamed = await upsertSingleUser(db, {
      username: "boss",
      name: "Boss",
      email: "boss@local",
    });
    expect(renamed.id).toBe(first.id);
    expect(renamed.username).toBe("boss");
    expect(renamed.email).toBe("boss@local");

    const rows = await db.select().from(users).all();
    expect(rows.length).toBe(1);
    expect(rows[0]?.role).toBe("admin");
  });

  test("re-promotes DEFAULT_ADMIN after the only admin is deleted", async () => {
    // Initial bootstrap.
    const initial = await upsertUser(
      db,
      { sub: "sub-initial", preferred_username: "initial", email: "initial@example.com", email_verified: true },
      authConfig(["initial@example.com", "backup@example.com"]),
      logger,
    );
    expect(initial.role).toBe("admin");

    // Operator removes the initial admin (e.g. employee left).
    await db.delete(users).where(eq(users.id, initial.id)).run();

    // A different DEFAULT_ADMIN logs in for the first time.
    const backup = await upsertUser(
      db,
      { sub: "sub-backup", preferred_username: "backup", email: "backup@example.com", email_verified: true },
      authConfig(["initial@example.com", "backup@example.com"]),
      logger,
    );
    expect(backup.role).toBe("admin");
  });

  test("unverified email cannot bootstrap admin", async () => {
    // email_verified absent → DEFAULT_ADMIN email match must not grant admin.
    const attacker = await upsertUser(
      db,
      { sub: "attacker-sub", preferred_username: "attacker", email: "admin@example.com" },
      authConfig(["admin@example.com", "admin2@example.com"]),
      logger,
    );
    expect(attacker.role).toBe("user");

    // email_verified false, distinct admin email (avoids unique-index clash).
    const stillUser = await upsertUser(
      db,
      { sub: "attacker-sub-2", preferred_username: "attacker2", email: "admin2@example.com", email_verified: false },
      authConfig(["admin@example.com", "admin2@example.com"]),
      logger,
    );
    expect(stillUser.role).toBe("user");
  });

  test("unverified email cannot take over an existing (admin) row", async () => {
    // Legitimate verified admin.
    const victim = await upsertUser(
      db,
      { sub: "victim-sub", preferred_username: "victim", email: "victim@example.com", email_verified: true },
      authConfig(["victim@example.com"]),
      logger,
    );
    expect(victim.role).toBe("admin");

    // Different username, victim's email, unverified: email match ignored,
    // victim row not rebound, fresh insert collides on unique email → throws.
    await expect(upsertUser(
      db,
      { sub: "attacker-sub", preferred_username: "mallory", email: "victim@example.com" },
      authConfig(["victim@example.com"]),
      logger,
    )).rejects.toThrow();

    const victimRow = await db.select().from(users).where(eq(users.id, victim.id)).get();
    expect(victimRow?.oauthSub).toBe("victim-sub");
    expect(victimRow?.role).toBe("admin");

    const attackerRow = await db.select().from(users).where(eq(users.oauthSub, "attacker-sub")).get();
    expect(attackerRow).toBeUndefined();
  });
});

describe("upsertUser identity ownership (FEAT-038)", () => {
  test("does not re-derive local name or username from the token on re-login", async () => {
    const created = await upsertUser(
      db,
      { sub: "sub-x", preferred_username: "alice", email: "alice@example.com", email_verified: true, name: "Alice" },
      authConfig([]),
      logger,
    );
    // Admin edits the name locally; identity is keyed on sub.
    await db.update(users).set({ name: "Alice Local" }).where(eq(users.id, created.id)).run();

    // Upstream later sends a different name AND a renamed username.
    const relogin = await upsertUser(
      db,
      { sub: "sub-x", preferred_username: "alice-renamed", email: "alice@example.com", email_verified: true, name: "Alice Upstream" },
      authConfig([]),
      logger,
    );
    expect(relogin.id).toBe(created.id);

    const row = await db.select().from(users).where(eq(users.id, created.id)).get();
    expect(row?.name).toBe("Alice Local");
    expect(row?.username).toBe("alice");
  });
});

describe("upsertUser virtual-user binding (FEAT-038)", () => {
  test("binds a virtual user when a username claim AND verified email match", async () => {
    const v = await createVirtualUser(db, { username: "zhangsan", name: "Zhang San", email: "zhangsan@corp.com" });

    const bound = await upsertUser(
      db,
      { sub: "idp-zs", preferred_username: "zhangsan", email: "zhangsan@corp.com", email_verified: true, name: "Upstream Name" },
      authConfig([]),
      logger,
    );

    expect(bound.id).toBe(v!.id);
    expect(bound.isVirtual).toBe(false);
    expect(bound.oauthSub).toBe("idp-zs");
    // Local name and username survive the conversion.
    expect(bound.name).toBe("Zhang San");
    expect(bound.username).toBe("zhangsan");

    const rows = await db.select().from(users).all();
    expect(rows.length).toBe(1);
  });

  test("matches the `username` claim, not only `preferred_username`", async () => {
    const v = await createVirtualUser(db, { username: "lisi", name: "Li Si", email: "lisi@corp.com" });

    const bound = await upsertUser(
      db,
      { sub: "idp-ls", preferred_username: "l.si", username: "lisi", email: "lisi@corp.com", email_verified: true },
      authConfig([]),
      logger,
    );

    expect(bound.id).toBe(v!.id);
    expect(bound.isVirtual).toBe(false);
    expect(bound.username).toBe("lisi");
  });

  test("binds by verified email alone when the token carries no username claim", async () => {
    const v = await createVirtualUser(db, { username: "wangwu", name: "Wang Wu", email: "wangwu@corp.com" });

    const bound = await upsertUser(
      db,
      { sub: "idp-ww", email: "wangwu@corp.com", email_verified: true },
      authConfig([]),
      logger,
    );

    expect(bound.id).toBe(v!.id);
    expect(bound.isVirtual).toBe(false);
  });

  test("does not bind a virtual user on an unverified email", async () => {
    const v = await createVirtualUser(db, { username: "zhaoliu", name: "Zhao Liu", email: "zhaoliu@corp.com" });

    // Username would match but the email is not verified → no bind; a fresh
    // real user is created with the distinct upstream email instead.
    const result = await upsertUser(
      db,
      { sub: "idp-zl", preferred_username: "zhaoliu2", email: "zhaoliu2@corp.com" },
      authConfig([]),
      logger,
    );
    expect(result.id).not.toBe(v!.id);

    const stillVirtual = await db.select().from(users).where(eq(users.id, v!.id)).get();
    expect(stillVirtual?.isVirtual).toBe(true);
  });

  test("requires BOTH username and email to match when a username claim is present", async () => {
    const v = await createVirtualUser(db, { username: "qian", name: "Qian", email: "qian@corp.com" });

    // Username claim present but differs; email matches the virtual row. Since a
    // username claim exists, email-only fallback does not apply, so no bind —
    // and the fresh insert collides on the unique email.
    await expect(upsertUser(
      db,
      { sub: "idp-q", preferred_username: "different", email: "qian@corp.com", email_verified: true },
      authConfig([]),
      logger,
    )).rejects.toThrow();

    const stillVirtual = await db.select().from(users).where(eq(users.id, v!.id)).get();
    expect(stillVirtual?.isVirtual).toBe(true);
  });
});

describe("session lifetime (FIX-046)", () => {
  // oauthSessionAuthProvider only reads NODE_ENV + BASE_PATH off the config.
  const cfg = { NODE_ENV: "test", BASE_PATH: "" } as unknown as Config;

  async function resolveWithCookie(sessionId: string): Promise<string | null> {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("config", cfg);
      await next();
    });
    app.get("/probe", async c =>
      c.json({ id: (await oauthSessionAuthProvider(db, c))?.id ?? null }));
    const res = await app.request("/probe", { headers: { cookie: `session_id=${sessionId}` } });
    return (await res.json() as { id: string | null }).id;
  }

  test("ceiling uses sessionMaxAge; access-token expiry is tracked separately", async () => {
    const user = await createVirtualUser(db, { username: "sess1", name: "Sess One" });
    const sessionId = await createSession(db, user!.id, "tok", "refresh", 86400, 3600);

    const row = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    const ceilingMs = new Date(row!.expiresAt).getTime() - Date.now();
    const tokenMs = new Date(row!.accessTokenExpiresAt!).getTime() - Date.now();
    // Ceiling ~ 24h (driven by sessionMaxAge), not ~1h (the old access-token bug).
    expect(ceilingMs).toBeGreaterThan(80_000 * 1000);
    // Access-token clock tracks the IdP TTL independently.
    expect(tokenMs).toBeLessThan(2 * 3600 * 1000);
  });

  test("keeps the user logged in when the access token expired, no refresh token, within ceiling", async () => {
    const user = await createVirtualUser(db, { username: "sess2", name: "Sess Two" });
    const sessionId = await createSession(db, user!.id, "tok", undefined, 86400, 3600);
    // Access token already expired; ceiling still far in the future.
    await db.update(sessions)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();

    // Reproduces FIX-046: previously this path tore the session down.
    expect(await resolveWithCookie(sessionId)).toBe(user!.id);
    const row = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    expect(row).toBeDefined();
  });

  test("tears the session down once the ceiling is reached", async () => {
    const user = await createVirtualUser(db, { username: "sess3", name: "Sess Three" });
    const sessionId = await createSession(db, user!.id, "tok", undefined, 86400, 3600);
    // Force the ceiling into the past.
    await db.update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();

    expect(await resolveWithCookie(sessionId)).toBeNull();
    const row = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    expect(row).toBeUndefined();
  });
});

describe("readIdTokenSub — present vs absent vs unparseable", () => {
  function jwt(payload: object): string {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "none" })}.${b64(payload)}.`;
  }

  test("absent id_token → null (pure OAuth2, skip is acceptable)", () => {
    expect(__readIdTokenSubForTests(undefined)).toBeNull();
  });

  test("valid id_token → returns sub", () => {
    expect(__readIdTokenSubForTests(jwt({ sub: "user-123" }))).toBe("user-123");
  });

  test("present but not a JWT (wrong segment count) → throws, no skip", () => {
    expect(() => __readIdTokenSubForTests("not-a-jwt")).toThrow(__IdTokenErrorForTests);
  });

  test("present with non-JSON payload → throws, no skip", () => {
    expect(() => __readIdTokenSubForTests("aaa.%%%notbase64json%%%.ccc")).toThrow(__IdTokenErrorForTests);
  });

  test("present but sub missing / non-string → throws, no skip", () => {
    expect(() => __readIdTokenSubForTests(jwt({ email: "a@b.c" }))).toThrow(__IdTokenErrorForTests);
    expect(() => __readIdTokenSubForTests(jwt({ sub: 42 }))).toThrow(__IdTokenErrorForTests);
    expect(() => __readIdTokenSubForTests(jwt({ sub: "" }))).toThrow(__IdTokenErrorForTests);
  });
});

// FIX-073: an expired access token with a refresh token used to be refreshed
// INLINE, so a hung IdP token endpoint pinned every request of that session.
// The refresh now runs in the background; the provider resolves the user
// from the still-valid session at once.
describe("background access-token refresh (FIX-073)", () => {
  const oauthCfg = {
    NODE_ENV: "test",
    BASE_PATH: "",
    OAUTH_CLIENT_ID: "client-abc",
    OAUTH_AUTHORIZE_URL: "https://idp.example.com/authorize",
    OAUTH_TOKEN_URL: "https://idp.example.com/token",
    OAUTH_USERINFO_URL: "https://idp.example.com/userinfo",
    OAUTH_PKCE: true,
  } as unknown as Config;

  test("does not wait on a hung refresh-token grant", async () => {
    const user = await createVirtualUser(db, { username: "sess4", name: "Sess Four" });
    const sessionId = await createSession(db, user!.id, "tok", "refresh-tok", 86400, 3600);
    await db.update(sessions)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();

    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    globalThis.fetch = ((url: string | URL | Request) => {
      if (String(url).includes("/token"))
        tokenCalls++;
      return new Promise<Response>(() => {}); // never settles — a hung IdP
    }) as unknown as typeof fetch;
    try {
      const app = new Hono<AppEnv>();
      app.use("*", async (c, next) => {
        c.set("config", oauthCfg);
        await next();
      });
      app.get("/probe", async c => c.json({ id: (await oauthSessionAuthProvider(db, c))?.id ?? null }));

      const probe = Promise.resolve(app.request("/probe", { headers: { cookie: `session_id=${sessionId}` } }))
        .then(async res => (await res.json() as { id: string | null }).id);
      const outcome = await Promise.race([
        probe,
        new Promise<"timeout">(resolve => setTimeout(resolve, 1_000, "timeout")),
      ]);
      expect(outcome).toBe(user!.id);
      // The refresh was still attempted (in the background).
      expect(tokenCalls).toBe(1);
    }
    finally {
      globalThis.fetch = originalFetch;
    }
  });
});
