import type { AppDatabase } from "@/db";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { AppError } from "@/shared/lib/errors";
import { webhookDeliveries } from "./schema";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  matchesEvent,
  normalizeEvents,
  signPayload,
  updateWebhook,
  validateWebhookUrl,
} from "./webhook.service";

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "webhook-service-"));
  db = await createDb(resolve(dir, "app.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("matchesEvent", () => {
  test("`*` matches everything, exact names match themselves, `prefix.*` matches the dotted namespace", () => {
    expect(matchesEvent(["*"], "anything.at.all")).toBe(true);
    expect(matchesEvent(["issue.assigned"], "issue.assigned")).toBe(true);
    expect(matchesEvent(["issue.assigned"], "issue.created")).toBe(false);
    expect(matchesEvent(["issue.*"], "issue.assigned")).toBe(true);
    expect(matchesEvent(["issue.*"], "issues.create")).toBe(false);
    expect(matchesEvent(["issue.*"], "issue")).toBe(false);
    expect(matchesEvent([], "issue.assigned")).toBe(false);
  });
});

describe("normalizeEvents", () => {
  test("trims, drops blanks and duplicates, and collapses onto `*`", () => {
    expect(normalizeEvents([" issue.* ", "", "share.created", "issue.*"])).toEqual(["issue.*", "share.created"]);
    expect(normalizeEvents(["share.created", "*"])).toEqual(["*"]);
    expect(normalizeEvents([])).toEqual([]);
  });
});

describe("signPayload", () => {
  test("is sha256= plus the hex HMAC of timestamp-dot-body", () => {
    const body = "{\"event\":\"issue.assigned\"}";
    const expected = `sha256=${createHmac("sha256", "s3cret").update("1725148800.{\"event\":\"issue.assigned\"}").digest("hex")}`;
    expect(signPayload("s3cret", "1725148800", body)).toBe(expected);
    expect(signPayload("other", "1725148800", body)).not.toBe(expected);
  });
});

describe("validateWebhookUrl", () => {
  const allowPrivate = { HTTP_ACTION_ALLOW_PRIVATE: true };
  const blockPrivate = { HTTP_ACTION_ALLOW_PRIVATE: false };

  test("accepts http(s) URLs and rejects other schemes and garbage", async () => {
    await expect(validateWebhookUrl(allowPrivate, "https://93.184.216.34/hook")).resolves.toBeUndefined();
    await expect(validateWebhookUrl(allowPrivate, "http://127.0.0.1:9/hook")).resolves.toBeUndefined();
    await expect(validateWebhookUrl(allowPrivate, "ftp://example.com/x")).rejects.toBeInstanceOf(AppError);
    await expect(validateWebhookUrl(allowPrivate, "javascript:alert(1)")).rejects.toBeInstanceOf(AppError);
    await expect(validateWebhookUrl(allowPrivate, "not a url")).rejects.toBeInstanceOf(AppError);
  });

  test("refuses private / loopback destinations unless HTTP_ACTION_ALLOW_PRIVATE", async () => {
    await expect(validateWebhookUrl(blockPrivate, "http://127.0.0.1/hook")).rejects.toMatchObject({ code: "INVALID_WEBHOOK_URL" });
    await expect(validateWebhookUrl(blockPrivate, "http://169.254.169.254/latest")).rejects.toMatchObject({ code: "INVALID_WEBHOOK_URL" });
    await expect(validateWebhookUrl(blockPrivate, "https://93.184.216.34/hook")).resolves.toBeUndefined();
  });
});

describe("webhook CRUD", () => {
  test("create returns a view that never carries the secret, and enforces unique names", async () => {
    const view = await createWebhook(db, { name: "ops", url: "https://93.184.216.34/hook", secret: "s3cret", events: ["issue.*"], createdBy: "admin1" });
    expect(view.id).toBeTruthy();
    expect(view.hasSecret).toBe(true);
    expect("secret" in view).toBe(false);
    expect(view.events).toEqual(["issue.*"]);
    expect(view.enabled).toBe(true);
    expect(view.consecutiveFailures).toBe(0);
    await expect(createWebhook(db, { name: "ops", url: "https://93.184.216.34/other", events: ["*"], createdBy: "admin1" }))
      .rejects
      .toMatchObject({ code: "WEBHOOK_NAME_CONFLICT" });
    expect((await listWebhooks(db)).map(w => w.name)).toEqual(["ops"]);
  });

  test("update patches fields, clears the secret with null, keeps it when omitted", async () => {
    const created = await createWebhook(db, { name: "a", url: "https://93.184.216.34/a", secret: "k", events: ["*"], createdBy: "u" });
    const patched = await updateWebhook(db, created.id, { name: "b", events: ["share.*", "issue.*"], enabled: false });
    expect(patched?.name).toBe("b");
    expect(patched?.events).toEqual(["share.*", "issue.*"]);
    expect(patched?.enabled).toBe(false);
    expect(patched?.hasSecret).toBe(true);
    const cleared = await updateWebhook(db, created.id, { secret: null });
    expect(cleared?.hasSecret).toBe(false);
    expect(await updateWebhook(db, "missing", { name: "x" })).toBeUndefined();
  });

  test("delete removes the row and cascades its deliveries", async () => {
    const created = await createWebhook(db, { name: "d", url: "https://93.184.216.34/d", events: ["*"], createdBy: "u" });
    await db.insert(webhookDeliveries).values({ id: "01DEL", webhookId: created.id, event: "x.y", eventId: "e1", payload: "{}", createdAt: new Date().toISOString() }).run();
    expect(await deleteWebhook(db, created.id)).toBe(true);
    expect(await getWebhook(db, created.id)).toBeUndefined();
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, created.id)).all()).toEqual([]);
    expect(await deleteWebhook(db, created.id)).toBe(false);
  });

  test("listDeliveries pages newest first", async () => {
    const created = await createWebhook(db, { name: "l", url: "https://93.184.216.34/l", events: ["*"], createdBy: "u" });
    for (let i = 0; i < 5; i++) {
      await db.insert(webhookDeliveries).values({ id: `01DEL${i}`, webhookId: created.id, event: "x.y", eventId: `e${i}`, payload: "{}", createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString() }).run();
    }
    const page = await listDeliveries(db, created.id, { page: 1, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.data.map(d => d.id)).toEqual(["01DEL4", "01DEL3"]);
    expect(page.data[0]!.payload).toBe("{}");
  });
});
