import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/db";
import { auditEvents } from "@/modules/audit/schema";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { settings } from "./schema";
import { settingsRoutes } from "./settings.routes";
import { setSetting } from "./settings.service";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [settingsRoutes]);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-settings-routes-${Date.now()}-${testNanoid()}`);
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
  test("GET /settings → 401 without a session", async () => {
    const res = await buildApp().request("/settings");
    expect(res.status).toBe(401);
  });

  test("GET /settings → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/settings", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });

  test("PUT /settings/:key → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/settings/app.theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "dark" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /settings (list)", () => {
  test("lists rows and masks sensitive values", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await setSetting(db, "app.theme", "dark");
    await setSetting(db, "oauth.client_secret", "super-secret");

    const res = await buildApp().request("/settings", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { key: string; value: string }[] };
    expect(body.success).toBe(true);
    const byKey = new Map(body.data.map(r => [r.key, r.value]));
    expect(byKey.get("app.theme")).toBe("dark");
    expect(byKey.get("oauth.client_secret")).toBe("******");
  });

  test("prefix filter escapes LIKE metacharacters", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await setSetting(db, "app.theme", "dark");
    await setSetting(db, "appXtheme", "should-not-match");

    // `.` is a literal in our keys; the route escapes `%`/`_` so a prefix of
    // `app.` must not behave like the SQL single-char wildcard `app_`.
    const res = await buildApp().request("/settings?prefix=app.", { headers: { Cookie: cookie } });
    const body = await res.json() as { data: { key: string }[] };
    const keys = body.data.map(r => r.key);
    expect(keys).toContain("app.theme");
    expect(keys).not.toContain("appXtheme");
  });
});

describe("GET /settings/:key", () => {
  test("returns the value, masking sensitive keys", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await setSetting(db, "smtp.password", "hunter2");

    const res = await buildApp().request("/settings/smtp.password", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { key: string; value: string } };
    expect(body.data.value).toBe("******");
  });

  test("404s for an unknown key", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/app.missing", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("404s for a key that violates the key format (treated as not found)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    // Leading dot / uppercase fails SETTING_KEY_RE → NotFoundError.
    const res = await buildApp().request("/settings/.bad", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("PUT /settings/:key", () => {
  test("creates a setting and writes an audit row with the new value", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/app.theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "dark" }),
    });
    expect(res.status).toBe(200);

    const stored = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "setting.updated"), eq(auditEvents.actorId, userId))).get();
    expect(stored).toBeDefined();
    expect(stored!.resourceId).toBe("app.theme");
    const detail = JSON.parse(stored!.detail!) as { previousValue: string | null; newValue: string };
    expect(detail.previousValue).toBeNull();
    expect(detail.newValue).toBe("dark");
  });

  test("audit masks sensitive previous + new values", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await setSetting(db, "oauth.client_secret", "old-secret");

    await buildApp().request("/settings/oauth.client_secret", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "new-secret" }),
    });

    const stored = await db.select().from(auditEvents).where(eq(auditEvents.action, "setting.updated")).get();
    const detail = JSON.parse(stored!.detail!) as { previousValue: string; newValue: string };
    expect(detail.previousValue).toBe("******");
    expect(detail.newValue).toBe("******");
    // The real value still landed in storage, unmasked.
    const row = await db.select().from(settings).where(eq(settings.key, "oauth.client_secret")).get();
    expect(row!.value).toBe("new-secret");
  });

  test("rejects saving the masked placeholder for a sensitive key", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/api.token", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "******" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("MASKED_VALUE_REJECTED");
  });

  test("rejects an empty value with 422 (zod)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/app.theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "" }),
    });
    expect(res.status).toBe(422);
  });

  test("rejects a value over the 64 KiB bound with 422 (zod)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/app.blob", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "x".repeat(64 * 1024 + 1) }),
    });
    expect(res.status).toBe(422);
  });

  test("accepts a value at the 64 KiB bound", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/app.blob", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ value: "x".repeat(64 * 1024) }),
    });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /settings/:key", () => {
  test("deletes an existing setting and writes an audit row", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    await setSetting(db, "app.theme", "dark");

    const res = await buildApp().request("/settings/app.theme", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);

    const stored = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "setting.deleted"), eq(auditEvents.actorId, userId))).get();
    expect(stored).toBeDefined();
    expect(stored!.resourceId).toBe("app.theme");
  });

  test("404s when the key never existed", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/settings/app.ghost", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });
});
