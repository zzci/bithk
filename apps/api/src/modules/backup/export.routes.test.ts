import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { auditEvents } from "@/modules/audit/schema";
import { cronBackupContribution } from "@/modules/cron/cron.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
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

  test("POST /backup/export → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: ["settings"] }),
    });
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

describe("POST /backup/export", () => {
  test("streams a restorable JSON artifact and writes an audit row", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('app.theme', 'dark', '2026-01-01T00:00:00Z')`);

    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: ["settings"] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const dump = JSON.parse(await res.text()) as { version: number; modules: string[]; tables: Record<string, unknown[]> };
    expect(dump.version).toBe(1);
    expect(dump.modules).toContain("settings");
    expect(dump.tables.settings).toHaveLength(1);

    const auditRow = await db.select().from(auditEvents).get();
    expect(auditRow!.action).toBe("backup.export");
    expect(auditRow!.actorId).toBe(userId);
  });

  test("rejects unknown module names with 400 INVALID_MODULES", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: ["settings", "nope"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_MODULES");
  });

  test("rejects an empty module list with 422", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: [] }),
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /backup/export-via-token", () => {
  test("503 when no service token is configured", async () => {
    const res = await mountRoutes(db, [backupExportRoutes]).request("/backup/export-via-token", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
    });
    expect(res.status).toBe(503);
  });

  test("401 with a missing or wrong bearer token", async () => {
    const config = testConfig({ SERVICE_TOKEN_BACKUP: "s3cr3t-token-value" });
    const app = mountRoutes(db, [backupExportRoutes], config);

    const noTok = await app.request("/backup/export-via-token", { method: "POST" });
    expect(noTok.status).toBe(401);

    const wrong = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-but-same-length!!" },
    });
    expect(wrong.status).toBe(401);
  });

  test("200 with a valid token and an explicit module scope, audits as system", async () => {
    const config = testConfig({ SERVICE_TOKEN_BACKUP: "valid-token-aaaaaaaa" });
    const res = await mountRoutes(db, [backupExportRoutes], config).request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": "Bearer valid-token-aaaaaaaa", "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["settings", "users"] }),
    });
    expect(res.status).toBe(200);
    const dump = JSON.parse(await res.text()) as { modules: string[] };
    expect(dump.modules.sort()).toEqual(["settings", "users"]);

    const auditRow = await db.select().from(auditEvents).get();
    expect(auditRow!.action).toBe("backup.export");
    expect(auditRow!.actorId).toBe("system");
  });

  test("403 SCOPE_REQUIRED when the request carries no module scope (fail closed)", async () => {
    const config = testConfig({ SERVICE_TOKEN_BACKUP: "valid-token-aaaaaaaa" });
    const app = mountRoutes(db, [backupExportRoutes], config);

    // No body at all → unscoped → reject.
    const noBody = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token-aaaaaaaa" },
    });
    expect(noBody.status).toBe(403);
    const noBodyJson = await noBody.json() as { error: { code: string } };
    expect(noBodyJson.error.code).toBe("SCOPE_REQUIRED");

    // Empty module list → still unscoped → reject.
    const emptyList = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": "Bearer valid-token-aaaaaaaa", "Content-Type": "application/json" },
      body: JSON.stringify({ modules: [] }),
    });
    expect(emptyList.status).toBe(403);

    // No export should have been streamed → no success audit row.
    const successRow = await db.select().from(auditEvents).where(eq(auditEvents.result, "success")).get();
    expect(successRow).toBeUndefined();
  });

  test("400 INVALID_MODULES when a scoped token names an unknown module", async () => {
    const config = testConfig({ SERVICE_TOKEN_BACKUP: "valid-token-aaaaaaaa" });
    const res = await mountRoutes(db, [backupExportRoutes], config).request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": "Bearer valid-token-aaaaaaaa", "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["settings", "nope"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_MODULES");
  });

  test("redacts secret-typed fields from the token export", async () => {
    registerBackupContribution(cronBackupContribution);
    const secret = "Bearer super-secret-xyz-do-not-leak";
    await db.run(sql`
      INSERT INTO cron_jobs (id, name, cron, task_type, task_config, enabled, is_deleted, max_consecutive_failures, created_at, updated_at)
      VALUES ('job-1', 'nightly', '0 0 * * *', 'http_request', ${JSON.stringify({ url: "https://x", headers: { authorization: secret } })}, 1, 0, 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    const config = testConfig({ SERVICE_TOKEN_BACKUP: "redact-token-dddddddd" });
    const res = await mountRoutes(db, [backupExportRoutes], config).request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": "Bearer redact-token-dddddddd", "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["cron"] }),
    });
    expect(res.status).toBe(200);

    const raw = await res.text();
    // The plaintext secret must never appear anywhere in the artifact.
    expect(raw).not.toContain("super-secret-xyz");

    const dump = JSON.parse(raw) as { tables: Record<string, { id: string; taskConfig: string }[]> };
    const job = dump.tables.cron_jobs!.find(r => r.id === "job-1")!;
    expect(job.taskConfig).toBe("[REDACTED]");
    // Non-secret columns survive untouched.
    expect(job.id).toBe("job-1");
  });

  test("throttles successive exports within the min-interval window (429)", async () => {
    // Distinct token so the process-global last-success map cannot collide
    // with other cases in this file.
    const token = "throttle-token-bbbb";
    const config = testConfig({ SERVICE_TOKEN_BACKUP: token, BACKUP_EXPORT_MIN_INTERVAL_SECONDS: 3600 });
    const app = mountRoutes(db, [backupExportRoutes], config);

    const first = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["settings"] }),
    });
    expect(first.status).toBe(200);
    // Drain the stream so the in-flight marker releases before the next call.
    await first.text();

    const second = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["settings"] }),
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    const body = await second.json() as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  test("rejects a parallel in-flight export for the same token (429)", async () => {
    const token = "inflight-token-cccc";
    const config = testConfig({ SERVICE_TOKEN_BACKUP: token, BACKUP_EXPORT_MIN_INTERVAL_SECONDS: 0 });
    const app = mountRoutes(db, [backupExportRoutes], config);

    // Seed enough rows that the first export's stream cannot drain within the
    // microtask window before the second request checks the in-flight marker —
    // keeps the "parallel export rejected" assertion deterministic.
    await db.run(sql`
      WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 500)
      INSERT INTO settings (key, value, updated_at) SELECT 'k' || n, 'v', '2026-01-01T00:00:00Z' FROM c
    `);

    // Start an export but DON'T drain the body — the in-flight marker stays
    // set until the stream is read or cancelled.
    const first = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["settings"] }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/backup/export-via-token", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modules: ["settings"] }),
    });
    expect(second.status).toBe(429);
    const body = await second.json() as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");

    // Release the first stream so the marker clears for later tests.
    await first.body?.cancel();
  });
});
