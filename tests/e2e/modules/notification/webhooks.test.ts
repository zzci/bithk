// Webhook subscriptions (FEAT-060) over the live API: admin CRUD, the test
// ping delivered to a receiver started inside this test process (the e2e API
// runs with HTTP_ACTION_ALLOW_PRIVATE=true so loopback is reachable), and the
// delivery log. Signatures are verified against the shared secret.
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

interface Hit { headers: Record<string, string>; body: string }
interface WebhookView { id: string; name: string; url: string; events: string[]; enabled: boolean; hasSecret: boolean }
interface Delivery { id: string; event: string; status: string; attempts: number; responseStatus: number | null }

const hits: Hit[] = [];
let receiver: ReturnType<typeof Bun.serve> | null = null;
let receiverUrl = "";

beforeAll(() => {
  receiver = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      hits.push({ headers, body: await req.text() });
      return new Response("ok");
    },
  });
  receiverUrl = `http://127.0.0.1:${receiver.port}/hook`;
});

afterAll(() => {
  receiver?.stop(true);
});

describe("/api/admin/webhooks", () => {
  it("admin creates, tests, inspects deliveries, updates and deletes a webhook", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const token = Date.now().toString(36);
    const created = await admin.raw("/api/admin/webhooks", {
      method: "POST",
      body: { name: `e2e-hook-${token}`, url: receiverUrl, secret: "e2e-secret", events: ["issue.*"] },
    });
    expect(created.status).toBe(201);
    const hook = (await created.json() as { data: WebhookView }).data;
    expect(hook.hasSecret).toBe(true);
    expect(Object.hasOwn(hook, "secret")).toBe(false);

    const list = await admin.json<{ data: WebhookView[] }>("/api/admin/webhooks");
    expect(list.data.find(w => w.id === hook.id)).toBeDefined();

    // Test ping: 202, then the receiver sees one signed webhook.test POST.
    const test = await admin.raw(`/api/admin/webhooks/${hook.id}/test`, { method: "POST" });
    expect(test.status).toBe(202);
    const { deliveryId } = (await test.json() as { data: { deliveryId: string } }).data;

    const deadline = Date.now() + 15_000;
    let delivery: Delivery | undefined;
    while (Date.now() < deadline) {
      const log = await admin.json<{ data: Delivery[] }>(`/api/admin/webhooks/${hook.id}/deliveries?limit=5`);
      delivery = log.data.find(d => d.id === deliveryId);
      if (delivery && delivery.status !== "pending")
        break;
      await Bun.sleep(200);
    }
    expect(delivery?.status).toBe("success");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.responseStatus).toBe(200);

    const hit = hits.find(h => h.headers["x-webhook-delivery"] === deliveryId);
    expect(hit).toBeDefined();
    expect(hit!.headers["x-webhook-event"]).toBe("webhook.test");
    const ts = hit!.headers["x-webhook-timestamp"]!;
    expect(hit!.headers["x-webhook-signature"]).toBe(`sha256=${createHmac("sha256", "e2e-secret").update(`${ts}.${hit!.body}`).digest("hex")}`);
    expect((JSON.parse(hit!.body) as { event: string }).event).toBe("webhook.test");

    const patched = await admin.raw(`/api/admin/webhooks/${hook.id}`, { method: "PATCH", body: { enabled: false, events: ["*"] } });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { data: WebhookView }).data.enabled).toBe(false);

    const removed = await admin.raw(`/api/admin/webhooks/${hook.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await admin.raw(`/api/admin/webhooks/${hook.id}`)).status).toBe(404);
  }, 30_000);

  it("refuses non-http URLs and is admin-only", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const bad = await admin.raw("/api/admin/webhooks", { method: "POST", body: { name: "bad", url: "ftp://example.com/x", events: ["*"] } });
    expect(bad.status).toBe(400);
    const user = await getClient("user@example.com", "admin");
    expect((await user.raw("/api/admin/webhooks")).status).toBe(403);
    const anon = new ApiClient();
    expect((await anon.raw("/api/admin/webhooks")).status).toBe(401);
  });
});
