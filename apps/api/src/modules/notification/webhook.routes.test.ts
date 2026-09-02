import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { auditEvents } from "@/modules/audit/schema";
import { mountRoutes, sessionCookieFor, testConfig } from "@/shared/test/route-harness";
import { notificationRoutes } from "./notification.routes";
import { __resetWebhookDispatcherForTests, __setWebhookRetryDelaysForTests, __webhookDispatcherIdle } from "./webhook.dispatcher";
import "@/modules/account";

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "webhook-routes-"));
  db = await createDb(resolve(dir, "app.db"));
  __resetWebhookDispatcherForTests();
  __setWebhookRetryDelaysForTests([0, 0]);
});

afterEach(() => {
  __resetWebhookDispatcherForTests();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = testConfig({ HTTP_ACTION_ALLOW_PRIVATE: true });
const app = () => mountRoutes(db, [notificationRoutes], config);
const json = (body: unknown) => JSON.stringify(body);

async function adminCookie() {
  return (await sessionCookieFor(db, "admin")).cookie;
}

function startReceiver(): { url: string; hits: number; stop: () => void; count: () => number } {
  let hits = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    hits++;
    return new Response("ok");
  } });
  return { url: `http://127.0.0.1:${server.port}/hook`, hits, stop: () => server.stop(true), count: () => hits };
}

describe("/admin/webhooks", () => {
  test("every route is admin-only", async () => {
    expect((await app().request("/admin/webhooks")).status).toBe(401);
    const { cookie } = await sessionCookieFor(db, "user");
    const headers = { "Content-Type": "application/json", "Cookie": cookie };
    expect((await app().request("/admin/webhooks", { headers })).status).toBe(403);
    expect((await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "x", url: "https://93.184.216.34/h", events: ["*"] }) })).status).toBe(403);
    expect((await app().request("/admin/webhooks/abc", { method: "PATCH", headers, body: json({ name: "y" }) })).status).toBe(403);
    expect((await app().request("/admin/webhooks/abc", { method: "DELETE", headers })).status).toBe(403);
    expect((await app().request("/admin/webhooks/abc/test", { method: "POST", headers })).status).toBe(403);
    expect((await app().request("/admin/webhooks/abc/deliveries", { headers })).status).toBe(403);
  });

  test("create / list / read / update / delete round-trip; the secret is write-only", async () => {
    const cookie = await adminCookie();
    const headers = { "Content-Type": "application/json", "Cookie": cookie };
    const created = await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "ops", url: "https://93.184.216.34/hook", secret: "s3cret", events: ["issue.*", " share.created "] }) });
    expect(created.status).toBe(201);
    const view = (await created.json() as { data: Record<string, unknown> }).data;
    expect(view.hasSecret).toBe(true);
    expect(view.secret).toBeUndefined();
    expect(view.events).toEqual(["issue.*", "share.created"]);
    const id = view.id as string;

    const list = await app().request("/admin/webhooks", { headers });
    expect((await list.json() as { data: { id: string }[] }).data.map(w => w.id)).toEqual([id]);

    const one = await app().request(`/admin/webhooks/${id}`, { headers });
    expect(one.status).toBe(200);

    const patched = await app().request(`/admin/webhooks/${id}`, { method: "PATCH", headers, body: json({ enabled: false, secret: null }) });
    expect(patched.status).toBe(200);
    const patchedView = (await patched.json() as { data: Record<string, unknown> }).data;
    expect(patchedView.enabled).toBe(false);
    expect(patchedView.hasSecret).toBe(false);

    const removed = await app().request(`/admin/webhooks/${id}`, { method: "DELETE", headers });
    expect(removed.status).toBe(200);
    expect((await app().request(`/admin/webhooks/${id}`, { headers })).status).toBe(404);

    // Order by id (ULID) — a bare select may walk the action index instead of rowid order.
    const actions = (await db.select({ action: auditEvents.action }).from(auditEvents).orderBy(auditEvents.id).all()).map(r => r.action);
    expect(actions).toEqual(["webhook.created", "webhook.updated", "webhook.deleted"]);
  });

  test("validation: bad url (400 INVALID_WEBHOOK_URL), private url when gated, name conflict (409), empty events (422)", async () => {
    const cookie = await adminCookie();
    const headers = { "Content-Type": "application/json", "Cookie": cookie };
    const bad = await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "a", url: "ftp://x/y", events: ["*"] }) });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: { code: string } }).error.code).toBe("INVALID_WEBHOOK_URL");

    const gated = mountRoutes(db, [notificationRoutes], testConfig({ HTTP_ACTION_ALLOW_PRIVATE: false }));
    const priv = await gated.request("/admin/webhooks", { method: "POST", headers, body: json({ name: "a", url: "http://127.0.0.1/hook", events: ["*"] }) });
    expect(priv.status).toBe(400);

    const ok = await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "dup", url: "https://93.184.216.34/h", events: ["*"] }) });
    expect(ok.status).toBe(201);
    const dup = await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "dup", url: "https://93.184.216.34/h2", events: ["*"] }) });
    expect(dup.status).toBe(409);

    const empty = await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "e", url: "https://93.184.216.34/h", events: [] }) });
    expect(empty.status).toBe(422);
  });

  test("POST :id/test delivers a webhook.test ping and the deliveries log shows it", async () => {
    const rx = startReceiver();
    try {
      const cookie = await adminCookie();
      const headers = { "Content-Type": "application/json", "Cookie": cookie };
      const created = await app().request("/admin/webhooks", { method: "POST", headers, body: json({ name: "ping", url: rx.url, events: ["issue.*"] }) });
      const id = (await created.json() as { data: { id: string } }).data.id;

      const test = await app().request(`/admin/webhooks/${id}/test`, { method: "POST", headers });
      expect(test.status).toBe(202);
      const { deliveryId } = (await test.json() as { data: { deliveryId: string } }).data;
      await __webhookDispatcherIdle();
      expect(rx.count()).toBe(1);

      const log = await app().request(`/admin/webhooks/${id}/deliveries?limit=10`, { headers });
      expect(log.status).toBe(200);
      const body = await log.json() as { data: { id: string; event: string; status: string; attempts: number }[]; meta: { total: number } };
      expect(body.meta.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: deliveryId, event: "webhook.test", status: "success", attempts: 1 });

      const actions = (await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.action, "webhook.tested")).all());
      expect(actions).toHaveLength(1);
    }
    finally {
      rx.stop();
    }
  });

  test("404 for unknown ids on read / update / delete / test / deliveries", async () => {
    const cookie = await adminCookie();
    const headers = { "Content-Type": "application/json", "Cookie": cookie };
    expect((await app().request("/admin/webhooks/nope", { headers })).status).toBe(404);
    expect((await app().request("/admin/webhooks/nope", { method: "PATCH", headers, body: json({ name: "z" }) })).status).toBe(404);
    expect((await app().request("/admin/webhooks/nope", { method: "DELETE", headers })).status).toBe(404);
    expect((await app().request("/admin/webhooks/nope/test", { method: "POST", headers })).status).toBe(404);
    expect((await app().request("/admin/webhooks/nope/deliveries", { headers })).status).toBe(404);
  });
});
