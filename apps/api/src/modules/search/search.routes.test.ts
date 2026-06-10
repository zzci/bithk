import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { backfillGlobalRoles, createGlobalRole } from "@/modules/account/roles/roles.service";
import { users } from "@/modules/account/users/schema";
import { createDocument } from "@/modules/document/document.service";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createProject } from "@/modules/project/project.service";
import { mountRoutes, seedUser, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { searchRoutes } from "./search.routes";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [searchRoutes]);
}

interface SearchResponse {
  success: boolean;
  data: {
    documents: { title: string }[];
    issues: { title: string }[];
    projects: { title: string; id: string }[];
    drive: { title: string }[];
    ships: { title: string }[];
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-search-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  loadNamespaces();
  // Non-admin sessions resolve their visible modules through the default
  // role, which the boot backfill guarantees in production.
  await backfillGlobalRoles(db);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("auth gating", () => {
  test("GET /search → 401 without a session", async () => {
    const res = await buildApp().request("/search?q=anything");
    expect(res.status).toBe(401);
  });
});

describe("GET /search", () => {
  test("returns the caller's own resources", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await createDocument(db, { title: "Quarterly Report", creatorId: userId });
    await createProject(db, { name: "Quarterly Project", creatorId: userId });

    const res = await buildApp().request("/search?q=Quarterly", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as SearchResponse;
    expect(body.success).toBe(true);
    expect(body.data.documents.map(d => d.title)).toContain("Quarterly Report");
    expect(body.data.projects.map(p => p.title)).toContain("Quarterly Project");
  });

  test("does not leak another user's resources to a stranger", async () => {
    const owner = await seedUser(db, "user");
    await createDocument(db, { title: "Quarterly Report", creatorId: owner });
    await createProject(db, { name: "Quarterly Project", creatorId: owner });

    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/search?q=Quarterly", { headers: { Cookie: cookie } });
    const body = await res.json() as SearchResponse;
    expect(body.data.documents).toHaveLength(0);
    expect(body.data.projects).toHaveLength(0);
  });

  test("an admin session sees every matching project (admin bypass)", async () => {
    const owner = await seedUser(db, "user");
    await createProject(db, { name: "Quarterly Project", creatorId: owner });

    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/search?q=Quarterly", { headers: { Cookie: cookie } });
    const body = await res.json() as SearchResponse;
    expect(body.data.projects.map(p => p.title)).toContain("Quarterly Project");
  });

  test("blank query returns empty groups", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/search?q=%20%20", { headers: { Cookie: cookie } });
    const body = await res.json() as SearchResponse;
    expect(body.data).toEqual({ documents: [], issues: [], projects: [], drive: [], ships: [] });
  });

  test("missing q param is treated as a blank query", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/search", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as SearchResponse;
    expect(body.data.documents).toHaveLength(0);
  });

  test("clamps an over-large limit to 20 results", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    for (let i = 0; i < 25; i++)
      await createDocument(db, { title: `Doc ${i}`, creatorId: userId });

    const res = await buildApp().request("/search?q=Doc&limit=999", { headers: { Cookie: cookie } });
    const body = await res.json() as SearchResponse;
    expect(body.data.documents.length).toBeLessThanOrEqual(20);
  });

  test("a non-numeric limit falls back to the default", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    for (let i = 0; i < 12; i++)
      await createDocument(db, { title: `Note ${i}`, creatorId: userId });

    const res = await buildApp().request("/search?q=Note&limit=abc", { headers: { Cookie: cookie } });
    const body = await res.json() as SearchResponse;
    // Default page size is 8.
    expect(body.data.documents).toHaveLength(8);
  });
});

describe("GET /search module visibility (PLAN-076)", () => {
  test("hidden-module domains are excluded for a non-admin", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await createDocument(db, { title: "Quarterly Report", creatorId: userId });
    await createProject(db, { name: "Quarterly Project", creatorId: userId });

    // A role granting only `projects`: matching documents must disappear.
    const role = await createGlobalRole(db, { name: "Projects only", modules: ["projects"] });
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, userId)).run();

    const res = await buildApp().request("/search?q=Quarterly", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as SearchResponse;
    expect(body.data.projects.map(p => p.title)).toContain("Quarterly Project");
    expect(body.data.documents).toHaveLength(0);
  });

  test("an admin keeps full-domain results regardless of roles", async () => {
    const { cookie, userId } = await sessionCookieFor(db, "admin");
    await createDocument(db, { title: "Quarterly Report", creatorId: userId });
    await createProject(db, { name: "Quarterly Project", creatorId: userId });

    const res = await buildApp().request("/search?q=Quarterly", { headers: { Cookie: cookie } });
    const body = await res.json() as SearchResponse;
    expect(body.data.documents.map(d => d.title)).toContain("Quarterly Report");
    expect(body.data.projects.map(p => p.title)).toContain("Quarterly Project");
  });
});
