import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { backupRoutes } from "./backup.routes";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-backup-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("backupRoutes aggregator", () => {
  it("constructs a router that composes the v2 sub-routers", () => {
    const router = backupRoutes();
    expect(router).toBeDefined();
    expect(typeof router.fetch).toBe("function");
    expect((router.routes as unknown[]).length).toBeGreaterThan(0);
  });

  it("still serves GET /backup/modules to an admin", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await mountRoutes(db, [backupRoutes]).request("/backup/modules", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  // FIX-072: the v1 JSON routes (deprecated 2026-06-10) are gone. They must
  // 404 like any unknown path — not 400/422/503, which would prove a handler
  // is still mounted behind the auth gate.
  it("no longer mounts the v1 JSON import / export routes", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const app = mountRoutes(db, [backupRoutes]);
    const headers = { "Content-Type": "application/json", "Cookie": cookie };
    for (const path of ["/backup/import", "/backup/export", "/backup/export-via-token"]) {
      const res = await app.request(path, { method: "POST", headers, body: JSON.stringify({ modules: ["settings"] }) });
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 404`);
    }
  });
});
