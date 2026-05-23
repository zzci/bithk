import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { mountRoutes, sessionCookieFor, stubLogger, testNanoid } from "@/shared/test/route-harness";
import { auditRoutes } from "./audit.routes";
import { audit } from "./audit.service";
import { auditEvents } from "./schema";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [auditRoutes]);
}

async function seedEvent(overrides: Partial<Parameters<typeof audit>[2]> = {}): Promise<string | undefined> {
  return audit(db, stubLogger, {
    actorId: "actor-1",
    actorName: "Actor One",
    action: "thing.created",
    resourceType: "thing",
    resourceId: "thing-1",
    resourceName: "Thing One",
    ip: "127.0.0.1",
    userAgent: "test",
    result: "success",
    ...overrides,
  });
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-audit-routes-${Date.now()}-${testNanoid()}`);
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

describe("auth/admin gating", () => {
  test("GET /audit → 401 without a session", async () => {
    const res = await buildApp().request("/audit");
    expect(res.status).toBe(401);
  });

  test("GET /audit → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/audit", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });

  test("GET /audit/:id → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/audit/anything", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
});

describe("GET /audit (list + filters)", () => {
  test("returns events with pagination meta", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await seedEvent();
    await seedEvent({ action: "thing.updated" });

    const res = await buildApp().request("/audit", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: unknown[]; meta: { total: number; page: number; limit: number } };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(50);
  });

  test("filters by action prefix wildcard", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await seedEvent({ action: "cron.job.created" });
    await seedEvent({ action: "cron.job.deleted" });
    await seedEvent({ action: "setting.updated" });

    const res = await buildApp().request("/audit?action=cron.*", { headers: { Cookie: cookie } });
    const body = await res.json() as { data: { action: string }[]; meta: { total: number } };
    expect(body.meta.total).toBe(2);
    expect(body.data.every(e => e.action.startsWith("cron."))).toBe(true);
  });

  test("filters by actor, resource_type, and result", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await seedEvent({ actorId: "actor-A", resourceType: "thing", result: "success" });
    await seedEvent({ actorId: "actor-B", resourceType: "widget", result: "failure" });

    const byActor = await buildApp().request("/audit?actor_id=actor-A", { headers: { Cookie: cookie } });
    expect((await byActor.json() as { meta: { total: number } }).meta.total).toBe(1);

    const byType = await buildApp().request("/audit?resource_type=widget", { headers: { Cookie: cookie } });
    expect((await byType.json() as { meta: { total: number } }).meta.total).toBe(1);

    const byResult = await buildApp().request("/audit?result=failure", { headers: { Cookie: cookie } });
    expect((await byResult.json() as { meta: { total: number } }).meta.total).toBe(1);
  });

  test("date-only `to` is normalised to the end of the day so same-day events are included", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    // An event created mid-day on 2026-05-10 must survive a `to=2026-05-10`
    // filter — a naive lexical `lte` against the date-only string would drop it.
    await db.insert(auditEvents).values({
      id: testNanoid(),
      actorId: "actor-1",
      actorName: "Actor One",
      action: "thing.created",
      resourceType: "thing",
      resourceId: "thing-1",
      resourceName: "Thing One",
      ip: "127.0.0.1",
      userAgent: "test",
      result: "success",
      createdAt: "2026-05-10T12:00:00.000Z",
    }).run();

    const included = await buildApp().request("/audit?to=2026-05-10", { headers: { Cookie: cookie } });
    expect((await included.json() as { meta: { total: number } }).meta.total).toBe(1);

    const excluded = await buildApp().request("/audit?to=2026-05-09", { headers: { Cookie: cookie } });
    expect((await excluded.json() as { meta: { total: number } }).meta.total).toBe(0);
  });

  test("rejects a malformed date filter with 422", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/audit?from=not-a-date", { headers: { Cookie: cookie } });
    expect(res.status).toBe(422);
  });

  test("honours an explicit limit and page", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    for (let i = 0; i < 3; i++)
      await seedEvent({ resourceId: `thing-${i}` });

    const page1 = await buildApp().request("/audit?limit=2&page=1", { headers: { Cookie: cookie } });
    const body1 = await page1.json() as { data: unknown[]; meta: { total: number; limit: number } };
    expect(body1.data).toHaveLength(2);
    expect(body1.meta.total).toBe(3);
    expect(body1.meta.limit).toBe(2);

    const page2 = await buildApp().request("/audit?limit=2&page=2", { headers: { Cookie: cookie } });
    expect((await page2.json() as { data: unknown[] }).data).toHaveLength(1);
  });
});

describe("GET /audit/:id", () => {
  test("returns a single event by id", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const id = await seedEvent();

    const res = await buildApp().request(`/audit/${id}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; action: string } };
    expect(body.data.id).toBe(id!);
    expect(body.data.action).toBe("thing.created");
  });

  test("404s for an unknown id", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/audit/does-not-exist", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});
