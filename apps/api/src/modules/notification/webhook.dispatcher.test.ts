import type { AppDatabase } from "@/db";
import type { AuditEvent } from "@/modules/audit/audit.service";
import type { Logger } from "@/shared/lib/logger";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { webhookDeliveries, webhooks } from "./schema";
import {
  __resetWebhookDispatcherForTests,
  __setWebhookRetryDelaysForTests,
  __webhookDispatcherIdle,
  enqueueEvent,
  enqueueTest,
} from "./webhook.dispatcher";
import { createWebhook } from "./webhook.service";

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
  reopen: () => {},
} as unknown as Logger;

interface Hit {
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Loopback receiver whose responses are scripted per call. */
function startReceiver(statuses: number[]): { url: string; hits: Hit[]; stop: () => void } {
  const hits: Hit[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      hits.push({ headers, body: await req.text() });
      const status = statuses[Math.min(hits.length - 1, statuses.length - 1)] ?? 200;
      return new Response(status >= 300 && status < 400 ? null : "ok", { status, headers: status >= 300 && status < 400 ? { Location: "http://127.0.0.1:9/" } : {} });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/hook`, hits, stop: () => server.stop(true) };
}

let db: AppDatabase;
let dir: string;
const config = { HTTP_ACTION_ALLOW_PRIVATE: true, HTTP_ACTION_TIMEOUT_SECONDS: 5 };
const deps = () => ({ db, logger: stubLogger, config });

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "webhook-dispatch-"));
  db = await createDb(resolve(dir, "app.db"));
  __resetWebhookDispatcherForTests();
  __setWebhookRetryDelaysForTests([0, 0]);
});

afterEach(() => {
  __resetWebhookDispatcherForTests();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "01AUDIT",
    createdAt: "2026-09-01T00:00:00.000Z",
    actorId: "u1",
    actorName: "Alice",
    action: "issue.assigned",
    resourceType: "issue",
    resourceId: "iss1",
    resourceName: "Fix winch",
    detail: { from: null, to: "m1" },
    ip: "127.0.0.1",
    userAgent: "test",
    result: "success",
    ...overrides,
  };
}

async function deliveriesFor(webhookId: string) {
  return db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId)).all();
}

describe("webhook dispatcher", () => {
  test("posts a signed JSON payload to every enabled webhook whose patterns match", async () => {
    const rx = startReceiver([200]);
    try {
      const hook = await createWebhook(db, { name: "ops", url: rx.url, secret: "s3cret", events: ["issue.*"], createdBy: "u" });
      await createWebhook(db, { name: "other", url: rx.url, events: ["share.*"], createdBy: "u" });
      await createWebhook(db, { name: "off", url: rx.url, events: ["*"], enabled: false, createdBy: "u" });

      expect(await enqueueEvent(deps(), event())).toBe(1);
      await __webhookDispatcherIdle();

      expect(rx.hits).toHaveLength(1);
      const hit = rx.hits[0]!;
      expect(hit.headers["content-type"]).toContain("application/json");
      expect(hit.headers["x-webhook-event"]).toBe("issue.assigned");
      expect(hit.headers["x-webhook-delivery"]).toBeTruthy();
      const ts = hit.headers["x-webhook-timestamp"]!;
      expect(hit.headers["x-webhook-signature"]).toBe(`sha256=${createHmac("sha256", "s3cret").update(`${ts}.${hit.body}`).digest("hex")}`);
      const payload = JSON.parse(hit.body) as Record<string, unknown>;
      expect(payload.event).toBe("issue.assigned");
      expect(payload.id).toBe("01AUDIT");
      expect(payload.resource).toEqual({ type: "issue", id: "iss1", name: "Fix winch" });
      expect(payload.actor).toEqual({ id: "u1", name: "Alice" });
      expect(payload.detail).toEqual({ from: null, to: "m1" });

      const rows = await deliveriesFor(hook.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("success");
      expect(rows[0]!.attempts).toBe(1);
      expect(rows[0]!.responseStatus).toBe(200);
      expect(hit.headers["x-webhook-delivery"]).toBe(rows[0]!.id);
      const updated = await db.select().from(webhooks).where(eq(webhooks.id, hook.id)).get();
      expect(updated?.lastDeliveryStatus).toBe("success");
      expect(updated?.consecutiveFailures).toBe(0);
    }
    finally {
      rx.stop();
    }
  });

  test("omits the signature headers when the webhook has no secret", async () => {
    const rx = startReceiver([200]);
    try {
      await createWebhook(db, { name: "plain", url: rx.url, events: ["*"], createdBy: "u" });
      await enqueueEvent(deps(), event());
      await __webhookDispatcherIdle();
      expect(rx.hits[0]!.headers["x-webhook-signature"]).toBeUndefined();
      expect(rx.hits[0]!.headers["x-webhook-timestamp"]).toBeTruthy();
    }
    finally {
      rx.stop();
    }
  });

  test("retries a failing endpoint and succeeds once it recovers", async () => {
    const rx = startReceiver([500, 503, 200]);
    try {
      const hook = await createWebhook(db, { name: "flaky", url: rx.url, events: ["*"], createdBy: "u" });
      await enqueueEvent(deps(), event());
      await __webhookDispatcherIdle();
      expect(rx.hits).toHaveLength(3);
      const [row] = await deliveriesFor(hook.id);
      expect(row!.status).toBe("success");
      expect(row!.attempts).toBe(3);
      expect(row!.responseStatus).toBe(200);
    }
    finally {
      rx.stop();
    }
  });

  test("gives up after three attempts, records the last status, and counts consecutive failures", async () => {
    const rx = startReceiver([500]);
    try {
      const hook = await createWebhook(db, { name: "dead", url: rx.url, events: ["*"], createdBy: "u" });
      await enqueueEvent(deps(), event());
      await __webhookDispatcherIdle();
      await enqueueEvent(deps(), event({ id: "01AUDIT2" }));
      await __webhookDispatcherIdle();
      expect(rx.hits).toHaveLength(6);
      const rows = await deliveriesFor(hook.id);
      expect(rows.map(r => r.status)).toEqual(["failed", "failed"]);
      expect(rows[0]!.attempts).toBe(3);
      expect(rows[0]!.responseStatus).toBe(500);
      const updated = await db.select().from(webhooks).where(eq(webhooks.id, hook.id)).get();
      expect(updated?.consecutiveFailures).toBe(2);
      expect(updated?.lastDeliveryStatus).toBe("failed");
    }
    finally {
      rx.stop();
    }
  });

  test("treats a redirect as a failure instead of following it", async () => {
    const rx = startReceiver([302]);
    try {
      const hook = await createWebhook(db, { name: "redir", url: rx.url, events: ["*"], createdBy: "u" });
      await enqueueEvent(deps(), event());
      await __webhookDispatcherIdle();
      const [row] = await deliveriesFor(hook.id);
      expect(row!.status).toBe("failed");
      expect(row!.responseStatus).toBe(302);
    }
    finally {
      rx.stop();
    }
  });

  test("records a transport error for an unreachable endpoint", async () => {
    const rx = startReceiver([200]);
    const url = rx.url;
    rx.stop();
    const hook = await createWebhook(db, { name: "gone", url, events: ["*"], createdBy: "u" });
    await enqueueEvent(deps(), event());
    await __webhookDispatcherIdle();
    const [row] = await deliveriesFor(hook.id);
    expect(row!.status).toBe("failed");
    expect(row!.responseStatus).toBeNull();
    expect(row!.error).toBeTruthy();
  });

  test("refuses a private destination at delivery time when the gate is on", async () => {
    const rx = startReceiver([200]);
    try {
      const hook = await createWebhook(db, { name: "priv", url: rx.url, events: ["*"], createdBy: "u" });
      await enqueueEvent({ db, logger: stubLogger, config: { ...config, HTTP_ACTION_ALLOW_PRIVATE: false } }, event());
      await __webhookDispatcherIdle();
      expect(rx.hits).toHaveLength(0);
      const [row] = await deliveriesFor(hook.id);
      expect(row!.status).toBe("failed");
      expect(row!.error).toContain("private");
    }
    finally {
      rx.stop();
    }
  });

  test("enqueueTest posts a webhook.test ping regardless of the subscription patterns", async () => {
    const rx = startReceiver([200]);
    try {
      const hook = await createWebhook(db, { name: "ping", url: rx.url, events: ["issue.*"], createdBy: "u" });
      const deliveryId = await enqueueTest(deps(), hook.id, { id: "admin1", name: "Admin" });
      await __webhookDispatcherIdle();
      expect(rx.hits).toHaveLength(1);
      expect(rx.hits[0]!.headers["x-webhook-event"]).toBe("webhook.test");
      const rows = await deliveriesFor(hook.id);
      expect(rows[0]!.id).toBe(deliveryId);
      expect(rows[0]!.status).toBe("success");
    }
    finally {
      rx.stop();
    }
  });

  test("keeps only the latest 200 deliveries per webhook", async () => {
    const rx = startReceiver([200]);
    try {
      const hook = await createWebhook(db, { name: "big", url: rx.url, events: ["*"], createdBy: "u" });
      for (let i = 0; i < 205; i++) {
        await db.insert(webhookDeliveries).values({
          id: `01OLD${String(i).padStart(4, "0")}`,
          webhookId: hook.id,
          event: "x.y",
          eventId: `e${i}`,
          payload: "{}",
          status: "success",
          createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        }).run();
      }
      await enqueueEvent(deps(), event());
      await __webhookDispatcherIdle();
      const rows = await deliveriesFor(hook.id);
      expect(rows).toHaveLength(200);
      expect(rows.some(r => r.id === "01OLD0000")).toBe(false);
      expect(rows.some(r => r.event === "issue.assigned")).toBe(true);
    }
    finally {
      rx.stop();
    }
  });
});
