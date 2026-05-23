import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { sessions } from "@/modules/account/auth/schema";
import { auditEvents } from "@/modules/audit/schema";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { streamJsonBackup } from "./export.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import { backupImportRoutes } from "./restore.routes";
import { validateFileSize } from "./restore.service";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [backupImportRoutes]);
}

function importForm(payload: unknown, includeUsers?: boolean): FormData {
  const fd = new FormData();
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  fd.append("file", new File([text], "backup.json", { type: "application/json" }));
  if (includeUsers !== undefined)
    fd.append("includeUsers", String(includeUsers));
  return fd;
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done)
      break;
    if (value)
      out += dec.decode(value);
  }
  return out;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-backup-restore-${Date.now()}-${testNanoid()}`);
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
  test("POST /backup/import → 401 without a session", async () => {
    const res = await buildApp().request("/backup/import", { method: "POST", body: importForm({ version: 1, modules: ["settings"], tables: {} }) });
    expect(res.status).toBe(401);
  });

  test("POST /backup/import → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm({ version: 1, modules: ["settings"], tables: {} }) });
    expect(res.status).toBe(403);
  });
});

describe("input validation", () => {
  test("400 NO_FILE when no file part is present", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const fd = new FormData();
    fd.append("includeUsers", "false");
    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: fd });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("NO_FILE");
  });

  test("400 INVALID_JSON for a non-JSON file", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm("this is not json") });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_JSON");
  });

  test("400 for an unsupported backup version", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm({ version: 0, modules: ["settings"], tables: {} }) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("UNSUPPORTED_VERSION");
  });

  test("validateFileSize rejects files over the 50MB cap", () => {
    expect(() => validateFileSize(51 * 1024 * 1024)).toThrow(/File too large/);
    expect(() => validateFileSize(10 * 1024 * 1024)).not.toThrow();
  });
});

describe("includeUsers=false", () => {
  test("restores non-user tables and writes a backup.import audit row", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('app.theme', 'dark', '2026-01-01T00:00:00Z')`);

    const dump = JSON.parse(await streamToString(streamJsonBackup(db, ["settings"]).body));
    // Mutate the value so we can prove the restore overwrote the live row.
    dump.tables.settings[0].value = "light";

    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm(dump, false) });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; rowsImported: number; modules: string[] };
    expect(body.success).toBe(true);
    expect(body.rowsImported).toBeGreaterThanOrEqual(1);
    expect(body.modules).not.toContain("users");

    const stored = await db.all<{ value: string }>(sql`SELECT value FROM settings WHERE key = 'app.theme'`);
    expect(stored[0]!.value).toBe("light");

    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import")).get();
    expect(auditRow!.actorId).toBe(userId);
  });

  test("400 RESTORE_FK_MISSING_USERS when a row references an absent user", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const payload = {
      version: 1,
      modules: ["settings"],
      tables: {
        settings: [],
        // A non-user table whose FK points at a user that is not in the live DB.
        documents: [{ id: "doc-1", creator_id: "ghost-user" }],
      },
    };
    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm(payload, false) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("RESTORE_FK_MISSING_USERS");
  });
});

describe("includeUsers=true", () => {
  test("400 RESTORE_WOULD_LOCK_OUT when the importing admin is absent from the dump", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const payload = {
      version: 1,
      modules: ["users"],
      // A different admin — the importing admin is not present, so the
      // restore would lock them out.
      tables: { users: [{ id: "someone-else", role: "admin", status: "active" }] },
    };
    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm(payload, true) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("RESTORE_WOULD_LOCK_OUT");
  });

  test("restores users, writes per-user audit rows, and clears sessions (forced re-auth)", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    // A second user with a live session.
    const victim = await sessionCookieFor(db, "user");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('app.theme', 'dark', '2026-01-01T00:00:00Z')`);

    // A real, schema-valid dump that includes the importing admin (admin/active).
    const dump = JSON.parse(await streamToString(streamJsonBackup(db, ["users", "settings"]).body));

    const res = await buildApp().request("/backup/import", { method: "POST", headers: { Cookie: cookie }, body: importForm(dump, true) });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    // One user.restored row per user in the dump (admin + victim).
    const restoredRows = await db.select().from(auditEvents).where(eq(auditEvents.action, "user.restored")).all();
    expect(restoredRows.length).toBe(2);

    const importAudit = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import")).get();
    expect(importAudit).toBeDefined();
    expect(importAudit!.actorId).toBe(userId);

    // Replacing the users table cascades through the sessions FK, so every
    // pre-restore session is gone — all users must re-authenticate.
    const victimSessions = await db.select().from(sessions).where(eq(sessions.userId, victim.userId)).all();
    expect(victimSessions).toHaveLength(0);
    const adminSessions = await db.select().from(sessions).where(eq(sessions.userId, userId)).all();
    expect(adminSessions).toHaveLength(0);
  });
});
