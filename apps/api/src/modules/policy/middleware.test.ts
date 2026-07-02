import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { TokenScopeMap } from "@/modules/account/tokens/scope";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv, User } from "@/shared/lib/types";
import type { AuthProvider } from "@/shared/middleware/auth-registry";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { apiTokenScopeGuard } from "@/shared/middleware/api-token-scope";
import { getAuthProvider, registerAuthProvider } from "@/shared/middleware/auth-registry";
import { errorHandler } from "@/shared/middleware/error-handler";
import { policyMiddleware } from "./middleware";
import { loadNamespaces } from "./namespace-config";
import { defineResource } from "./permission";
import { __resetResourceRegistryForTests, getAllResources, registerResource } from "./registry";
import { __resetRouteBindingsForTests, getAllRouteBindings, registerRouteBinding } from "./route-registry";
import { relationTuples } from "./schema";

// Direct tests for the global route-authorization gate. Decisions resolve
// through the real Zanzibar engine against a throwaway SQLite DB (no engine
// mocks), driven by synthetic resources so no real module is involved —
// except the PAT suite, which deliberately routes under `/contacts` so
// `apiTokenScopeGuard` maps the path to a real token module.
const testNamespaces = [
  { name: "user" },
  {
    name: "mwtest_doc",
    relations: {
      viewer: { union: [{ this: {} }] },
      editor: { union: [{ this: {} }] },
    },
  },
  {
    name: "mwtest_plain",
    relations: {
      viewer: { union: [{ this: {} }] },
    },
  },
] as const;

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

// Only `BASE_PATH` is consumed on these paths (by `apiTokenScopeGuard`).
const stubConfig = { BASE_PATH: "" } as unknown as Config;

// The registries are process-global singletons populated at import time by
// every resource module. Snapshot whatever is already registered and restore
// it after this suite (mirrors route-registry.test.ts). The access-instance
// map is NOT reset: it has no enumerator to snapshot, and the extra
// `mwtest-*` entries left behind are inert once the bindings are restored.
const initialBindings = getAllRouteBindings();
const initialResources = getAllResources();

afterAll(() => {
  __resetRouteBindingsForTests();
  for (const b of initialBindings)
    registerRouteBinding(b);
  __resetResourceRegistryForTests();
  for (const d of initialResources)
    registerResource(d);
});

function fakeUser(id: string, role: "admin" | "user"): User {
  return { id, role, name: id } as unknown as User;
}

describe("policyMiddleware", () => {
  let db: AppDatabase;
  let dbPath: string;

  beforeEach(async () => {
    loadNamespaces(testNamespaces);
    __resetRouteBindingsForTests();
    __resetResourceRegistryForTests();

    // Fail-closed existence policy (readAction set): denied read → 404.
    defineResource({
      name: "mwtest-doc",
      namespace: "mwtest_doc",
      actions: { "doc:read": "viewer", "doc:update": "editor" },
      readAction: "doc:read",
      routes: [
        { method: "GET", path: "/mwtest-docs/:id", action: "doc:read" },
        { method: "PATCH", path: "/mwtest-docs/:id", action: "doc:update" },
        { method: "GET", path: "/contacts/:id", action: "doc:read" },
      ],
    });
    // Legacy semantics (no readAction): denied read → 403.
    defineResource({
      name: "mwtest-plain",
      namespace: "mwtest_plain",
      actions: { "plain:read": "viewer" },
      routes: [
        { method: "GET", path: "/mwtest-plain/:id", action: "plain:read" },
      ],
    });
    // A binding whose resource was never registered — the wiring bug the
    // middleware must fail closed on.
    registerRouteBinding({ resourceName: "mwtest-ghost", method: "GET", path: "/mwtest-ghost/:id", action: "ghost:read" });

    const dir = resolve(tmpdir(), `test-policy-middleware-${Date.now()}-${nanoid()}`);
    mkdirSync(dir, { recursive: true });
    dbPath = resolve(dir, "test.db");
    db = await createDb(dbPath);
  });

  afterEach(() => {
    db.close();
    const dir = resolve(dbPath, "..");
    if (existsSync(dir))
      rmSync(dir, { recursive: true, force: true });
    // loadNamespaces is a clear+replace singleton — restore defaults so the
    // test-only namespaces do not leak into other policy test files.
    loadNamespaces();
  });

  async function grant(namespace: string, objectId: string, relation: string, userId: string) {
    await db.insert(relationTuples).values({
      id: nanoid(),
      namespace,
      objectId,
      relation,
      subjectNamespace: "user",
      subjectId: userId,
      subjectRelation: null,
      createdBy: null,
      createdAt: new Date().toISOString(),
    }).run();
  }

  function buildApp(opts: { readonly withPatGuard?: boolean } = {}): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("config", stubConfig);
      c.set("logger", stubLogger);
      c.set("requestId", "test");
      const uid = c.req.header("x-uid");
      if (uid)
        c.set("user", fakeUser(uid, c.req.header("x-role") === "admin" ? "admin" : "user"));
      const scopes = c.req.header("x-pat-scopes");
      if (scopes !== undefined)
        c.set("apiToken", { id: "tok-1", scopes: JSON.parse(scopes) as TokenScopeMap });
      await next();
    });
    if (opts.withPatGuard)
      app.use("*", apiTokenScopeGuard());
    app.use("*", policyMiddleware());
    app.get("/mwtest-docs/:id", c => c.json({ ok: true }));
    app.patch("/mwtest-docs/:id", c => c.json({ ok: true }));
    app.get("/mwtest-plain/:id", c => c.json({ ok: true }));
    app.get("/mwtest-ghost/:id", c => c.json({ ok: true }));
    app.get("/mwtest-free", c => c.json({ ok: true }));
    app.get("/contacts/:id", c => c.json({ ok: true }));
    app.onError(errorHandler);
    return app;
  }

  describe("route matching", () => {
    it("lets an undeclared route pass through, even anonymously", async () => {
      const app = buildApp();
      const res = await app.request("/mwtest-free");
      expect(res.status).toBe(200);
    });

    it("requires an actor on a declared route", async () => {
      // Provider stub so `loadActor` resolves "anonymous" deterministically
      // regardless of whether the account module registered the real one in
      // this process; restored immediately after.
      let prev: AuthProvider | undefined;
      try {
        prev = getAuthProvider();
      }
      catch {}
      registerAuthProvider(async () => undefined);
      try {
        const app = buildApp();
        const res = await app.request("/mwtest-docs/d1");
        expect(res.status).toBe(401);
      }
      finally {
        if (prev)
          registerAuthProvider(prev);
      }
    });
  });

  describe("enforcement semantics", () => {
    it("allows an actor holding the required relation", async () => {
      await grant("mwtest_doc", "d1", "viewer", "alice");
      const app = buildApp();
      const res = await app.request("/mwtest-docs/d1", { headers: { "x-uid": "alice" } });
      expect(res.status).toBe(200);
    });

    it("hides existence (404) from an actor with no read access when readAction is set", async () => {
      const app = buildApp();
      const res = await app.request("/mwtest-docs/d1", { headers: { "x-uid": "alice" } });
      expect(res.status).toBe(404);
    });

    it("returns 403 to an actor who can read but lacks the requested capability", async () => {
      await grant("mwtest_doc", "d1", "viewer", "alice");
      const app = buildApp();
      const res = await app.request("/mwtest-docs/d1", { method: "PATCH", headers: { "x-uid": "alice" } });
      expect(res.status).toBe(403);
    });

    it("returns legacy 403 on denial for a resource without readAction", async () => {
      const app = buildApp();
      const res = await app.request("/mwtest-plain/p1", { headers: { "x-uid": "alice" } });
      expect(res.status).toBe(403);
    });

    it("short-circuits admins before any policy check", async () => {
      const app = buildApp();
      const res = await app.request("/mwtest-docs/d1", { headers: { "x-uid": "root", "x-role": "admin" } });
      expect(res.status).toBe(200);
    });
  });

  describe("fail-closed wiring branch", () => {
    it("fails closed (500) when a matched binding has no registered resource", async () => {
      const app = buildApp();
      const res = await app.request("/mwtest-ghost/g1", { headers: { "x-uid": "alice" } });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("admin short-circuit still precedes the wiring check", async () => {
      const app = buildApp();
      const res = await app.request("/mwtest-ghost/g1", { headers: { "x-uid": "root", "x-role": "admin" } });
      expect(res.status).toBe(200);
    });
  });

  describe("PAT scope interaction", () => {
    const patHeaders = (uid: string, scopes: TokenScopeMap) => ({
      "x-uid": uid,
      "x-pat-scopes": JSON.stringify(scopes),
      "authorization": "Bearer bithk_pat_testsecret",
    });

    it("admits a scoped token whose owner also passes the policy check", async () => {
      await grant("mwtest_doc", "c1", "viewer", "alice");
      const app = buildApp({ withPatGuard: true });
      const res = await app.request("/contacts/c1", { headers: patHeaders("alice", { contacts: "read" }) });
      expect(res.status).toBe(200);
    });

    it("still enforces policy when the token scope allows the module", async () => {
      const app = buildApp({ withPatGuard: true });
      const res = await app.request("/contacts/c1", { headers: patHeaders("alice", { contacts: "read" }) });
      expect(res.status).toBe(404);
    });

    it("rejects an out-of-scope token before policy even when policy would allow", async () => {
      await grant("mwtest_doc", "c1", "viewer", "alice");
      const app = buildApp({ withPatGuard: true });
      const res = await app.request("/contacts/c1", { headers: patHeaders("alice", {}) });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe("TOKEN_SCOPE_INSUFFICIENT");
    });

    it("leaves cookie-session requests untouched by the guard", async () => {
      await grant("mwtest_doc", "c1", "viewer", "alice");
      const app = buildApp({ withPatGuard: true });
      const res = await app.request("/contacts/c1", { headers: { "x-uid": "alice" } });
      expect(res.status).toBe(200);
    });
  });
});
