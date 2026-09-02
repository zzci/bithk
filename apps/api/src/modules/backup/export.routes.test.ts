import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { backupExportRoutes } from "./export.routes";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-backup-export-${Date.now()}-${testNanoid()}`);
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

describe("auth/admin gating", () => {
  test("GET /backup/modules → 401 without a session", async () => {
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/modules");
    expect(res.status).toBe(401);
  });

  test("GET /backup/modules → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/modules", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
});

describe("GET /backup/modules", () => {
  test("lists registered modules sorted, with their deps", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/modules", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { modules: { name: string; deps: string[] }[] };
    const names = body.modules.map(m => m.name);
    expect(names).toEqual(["settings", "users"]);
  });
});
