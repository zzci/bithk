import type { AppEnv, User } from "@/shared/lib/types";
import type { AuthProvider } from "@/shared/middleware/auth-registry";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { getAuthProvider, registerAuthProvider } from "@/shared/middleware/auth-registry";
import { __resetRateLimitForTests } from "./rate-limit";
import { writeRateLimit } from "./write-rate-limit";

interface Budgets {
  readonly create?: number;
  readonly createHour?: number;
  readonly write?: number;
  readonly bulk?: number;
}

// The actor is taken from an `x-uid` header so a single app instance can
// exercise several callers; a request without it is anonymous and falls back
// to the IP key.
const provider: AuthProvider = async (_db, c) => {
  const uid = c.req.header("x-uid");
  return uid ? ({ id: uid, role: "user" } as User) : undefined;
};

let previousProvider: AuthProvider | undefined;

beforeEach(() => {
  __resetRateLimitForTests();
  try {
    previousProvider = getAuthProvider();
  }
  catch {
    previousProvider = undefined;
  }
  registerAuthProvider(provider);
});

afterEach(() => {
  __resetRateLimitForTests();
  if (previousProvider)
    registerAuthProvider(previousProvider);
});

function buildApp(budgets: Budgets = {}) {
  const config = {
    BASE_PATH: "",
    TRUST_PROXY: true,
    CREATE_RATE_LIMIT_PER_MINUTE: budgets.create ?? 30,
    CREATE_RATE_LIMIT_PER_HOUR: budgets.createHour ?? 300,
    WRITE_RATE_LIMIT_PER_MINUTE: budgets.write ?? 60,
    BULK_WRITE_RATE_LIMIT_PER_MINUTE: budgets.bulk ?? 600,
  } as unknown as AppEnv["Variables"]["config"];

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("config", config);
    c.set("db", {} as unknown as AppEnv["Variables"]["db"]);
    await next();
  });
  app.use("*", writeRateLimit());
  app.all("*", c => c.json({ ok: true }));
  return app;
}

function hit(app: Hono<AppEnv>, method: string, path: string, uid = "alice") {
  return app.request(path, { method, headers: { "x-uid": uid } });
}

describe("writeRateLimit", () => {
  test("reads are never counted", async () => {
    const app = buildApp({ create: 1, write: 1, bulk: 1 });
    for (let i = 0; i < 5; i++)
      expect((await hit(app, "GET", "/projects/p1/issues")).status).toBe(200);
  });

  test("record creation is capped by the per-minute create budget", async () => {
    const app = buildApp({ create: 2 });
    expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(200);
    expect((await hit(app, "POST", "/projects/p1/procurements")).status).toBe(200);
    const limited = await hit(app, "POST", "/documents");
    expect(limited.status).toBe(429);
    expect((await limited.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });

  test("record creation is also capped by the hourly budget", async () => {
    const app = buildApp({ create: 100, createHour: 2 });
    expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(200);
    expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(200);
    expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(429);
  });

  test("a create rejected by the per-minute budget does not consume the hourly one", async () => {
    // Fake clock so the minute window can roll over while the hour window does
    // not, which is the only way to observe what each bucket counted.
    const realNow = Date.now;
    let clock = 1_000_000;
    Date.now = () => clock;
    try {
      const app = buildApp({ create: 1, createHour: 2 });
      expect((await hit(app, "POST", "/documents")).status).toBe(200);
      expect((await hit(app, "POST", "/documents")).status).toBe(429);
      expect((await hit(app, "POST", "/documents")).status).toBe(429);
      clock += 60_001;
      // Only the first hit reached the hourly bucket, so one slot is left.
      expect((await hit(app, "POST", "/documents")).status).toBe(200);
      clock += 60_001;
      expect((await hit(app, "POST", "/documents")).status).toBe(429);
    }
    finally {
      Date.now = realNow;
    }
  });

  test("edits draw on a separate, larger budget than creates", async () => {
    const app = buildApp({ create: 1, write: 3 });
    expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(200);
    expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(429);
    // The create bucket is spent; per-field edits keep working.
    for (let i = 0; i < 3; i++)
      expect((await hit(app, "PATCH", "/projects/p1/issues/i1")).status).toBe(200);
    expect((await hit(app, "PATCH", "/projects/p1/issues/i1")).status).toBe(429);
  });

  test("upload surfaces draw on the bulk budget", async () => {
    const app = buildApp({ create: 1, write: 1, bulk: 3 });
    expect((await hit(app, "POST", "/drive/files/presign-upload")).status).toBe(200);
    expect((await hit(app, "POST", "/drive/files/confirm-upload")).status).toBe(200);
    expect((await hit(app, "POST", "/projects/p1/issues/i1/attachments")).status).toBe(200);
    expect((await hit(app, "POST", "/drive/folders")).status).toBe(429);
  });

  test("budgets are per actor, not per IP", async () => {
    const app = buildApp({ create: 1 });
    expect((await hit(app, "POST", "/contacts", "alice")).status).toBe(200);
    expect((await hit(app, "POST", "/contacts", "bob")).status).toBe(200);
    expect((await hit(app, "POST", "/contacts", "alice")).status).toBe(429);
  });

  test("anonymous callers fall back to the client IP", async () => {
    const app = buildApp({ create: 1 });
    const post = (ip: string) => app.request("/contacts", { method: "POST", headers: { "x-real-ip": ip } });
    expect((await post("1.1.1.1")).status).toBe(200);
    expect((await post("2.2.2.2")).status).toBe(200);
    expect((await post("1.1.1.1")).status).toBe(429);
  });

  test("a budget of 0 disables its bucket", async () => {
    const app = buildApp({ create: 0, write: 0, bulk: 0 });
    for (let i = 0; i < 20; i++) {
      expect((await hit(app, "POST", "/projects/p1/issues")).status).toBe(200);
      expect((await hit(app, "PATCH", "/projects/p1/issues/i1")).status).toBe(200);
      expect((await hit(app, "POST", "/drive/folders")).status).toBe(200);
    }
  });

  test("the mount's BASE_PATH prefix is stripped before classification", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("config", {
        BASE_PATH: "/app",
        TRUST_PROXY: true,
        CREATE_RATE_LIMIT_PER_MINUTE: 1,
        CREATE_RATE_LIMIT_PER_HOUR: 300,
        WRITE_RATE_LIMIT_PER_MINUTE: 60,
        BULK_WRITE_RATE_LIMIT_PER_MINUTE: 600,
      } as unknown as AppEnv["Variables"]["config"]);
      c.set("db", {} as unknown as AppEnv["Variables"]["db"]);
      await next();
    });
    app.use("*", writeRateLimit());
    app.all("*", c => c.json({ ok: true }));
    expect((await hit(app, "POST", "/app/api/documents")).status).toBe(200);
    expect((await hit(app, "POST", "/app/api/documents")).status).toBe(429);
  });
});
