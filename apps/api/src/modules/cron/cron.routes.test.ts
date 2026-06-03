import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/db";
import { auditEvents } from "@/modules/audit/schema";
import { cronJobLogs, cronJobs } from "@/modules/cron/schema";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { __resetAndReinitActionsForTests, defineAction, registerAction } from "./actions";
import { cronRoutes } from "./cron.routes";
import { __resetCronForTests } from "./cron.service";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [cronRoutes]);
}

async function createJob(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await buildApp().request("/cron/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify({ name: `job-${testNanoid()}`, cron: "*/5 * * * *", action: "log-cleanup", ...overrides }),
  });
  return res;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-cron-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  // Populate the action catalog without allocating the scheduler — routes
  // null-check `getScheduler()`, so DB writes land with the timer off.
  __resetAndReinitActionsForTests();
});

afterEach(async () => {
  await __resetCronForTests();
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("auth/admin gating", () => {
  test("GET /cron/jobs → 401 without a session", async () => {
    expect((await buildApp().request("/cron/jobs")).status).toBe(401);
  });

  test("GET /cron/jobs → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    expect((await buildApp().request("/cron/jobs", { headers: { Cookie: cookie } })).status).toBe(403);
  });

  test("POST /cron/jobs → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await createJob(cookie);
    expect(res.status).toBe(403);
  });
});

describe("GET /cron/actions", () => {
  test("returns the action catalog, cron formats, and scheduler state", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/cron/actions", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { actions: { name: string }[]; cronFormats: string[]; schedulerEnabled: boolean } };
    expect(body.data.actions.map(a => a.name)).toContain("log-cleanup");
    expect(body.data.cronFormats.length).toBeGreaterThan(0);
    // No startCron in tests → scheduler off.
    expect(body.data.schedulerEnabled).toBe(false);
  });
});

describe("POST /cron/jobs", () => {
  test("creates a job, returns 201, and writes an audit row", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const res = await createJob(cookie, { name: "nightly-cleanup" });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { id: string; name: string } };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("nightly-cleanup");

    const row = await db.select().from(cronJobs).where(eq(cronJobs.name, "nightly-cleanup")).get();
    expect(row).toBeDefined();
    // 5-field cron expands to 6 fields on store.
    expect(row!.cron).toBe("0 */5 * * * *");

    const auditRow = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "cron.job.created"), eq(auditEvents.actorId, userId))).get();
    expect(auditRow!.resourceName).toBe("nightly-cleanup");
  });

  test("rejects an invalid cron expression with 400 INVALID_CRON", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await createJob(cookie, { cron: "not a cron" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_CRON");
  });

  test("rejects a duplicate name with 409 JOB_NAME_CONFLICT", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await createJob(cookie, { name: "dupe" });
    const res = await createJob(cookie, { name: "dupe" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("JOB_NAME_CONFLICT");
  });

  test("rejects an unknown action with 400 INVALID_ACTION_CONFIG", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await createJob(cookie, { action: "no-such-action" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_ACTION_CONFIG");
  });

  test("rejects a name with illegal characters with 422", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await createJob(cookie, { name: "bad name!" });
    expect(res.status).toBe(422);
  });

  test("rejects a config that fails the action's input validation with 400", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    // http-request requires a `url` input; omitting it must be rejected.
    const res = await createJob(cookie, { action: "http-request", config: {} });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_ACTION_CONFIG");
  });
});

describe("GET /cron/jobs (listing + filters)", () => {
  test("lists live jobs and paginates with a cursor", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await createJob(cookie, { name: "a" });
    await createJob(cookie, { name: "b" });

    const res = await buildApp().request("/cron/jobs?limit=1", { headers: { Cookie: cookie } });
    const body = await res.json() as { data: { jobs: { name: string }[]; hasMore: boolean; nextCursor: string | null } };
    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.nextCursor).toBeTruthy();
  });

  test("deleted=only surfaces only tombstones", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const created = await (await createJob(cookie, { name: "doomed" })).json() as { data: { id: string } };
    await buildApp().request(`/cron/jobs/${created.data.id}`, { method: "DELETE", headers: { Cookie: cookie } });

    const live = await buildApp().request("/cron/jobs", { headers: { Cookie: cookie } });
    expect((await live.json() as { data: { jobs: unknown[] } }).data.jobs).toHaveLength(0);

    const tomb = await buildApp().request("/cron/jobs?deleted=only", { headers: { Cookie: cookie } });
    expect((await tomb.json() as { data: { jobs: { name: string }[] } }).data.jobs.map(j => j.name)).toContain("doomed");
  });
});

describe("DELETE /cron/jobs/:id", () => {
  test("soft-deletes the job and writes an audit row", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const created = await (await createJob(cookie, { name: "to-delete" })).json() as { data: { id: string } };

    const res = await buildApp().request(`/cron/jobs/${created.data.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    const row = await db.select().from(cronJobs).where(eq(cronJobs.id, created.data.id)).get();
    expect(row!.isDeleted).toBe(true);
    expect(row!.enabled).toBe(false);

    const auditRow = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "cron.job.deleted"), eq(auditEvents.actorId, userId))).get();
    expect(auditRow).toBeDefined();
  });

  test("404s for an unknown job", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/cron/jobs/missing", { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("POST /cron/jobs/:id/trigger", () => {
  test("executes the action, records a log row, and audits the trigger", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const created = await (await createJob(cookie, { name: "manual" })).json() as { data: { id: string } };

    const res = await buildApp().request(`/cron/jobs/${created.data.id}/trigger`, { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { triggered: boolean; log: { status: string } | null } };
    expect(body.data.triggered).toBe(true);
    expect(body.data.log!.status).toBe("success");

    const logs = await db.select().from(cronJobLogs).where(eq(cronJobLogs.jobId, created.data.id)).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe("success");

    const auditRow = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "cron.job.triggered"), eq(auditEvents.actorId, userId))).get();
    expect(auditRow).toBeDefined();
  });

  test("404s for an unknown job", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/cron/jobs/missing/trigger", { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("secret redaction in responses (FIX-AUDIT-005)", () => {
  test("redacts a Bearer token nested in http-request headers (create + list)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const secret = "top-secret-bearer-token";
    const created = await createJob(cookie, {
      name: "http-secret",
      action: "http-request",
      config: { url: "https://example.com/health", headers: { Authorization: `Bearer ${secret}` } },
    });
    expect(created.status).toBe(201);

    const createBody = await created.json() as { data: { taskConfig: { headers: Record<string, string> } } };
    expect(createBody.data.taskConfig.headers.Authorization).toBe("[REDACTED]");
    // The token must not appear anywhere in the create response.
    expect(JSON.stringify(createBody)).not.toContain(secret);

    // The listing endpoint must redact too.
    const list = await buildApp().request("/cron/jobs", { headers: { Cookie: cookie } });
    expect(JSON.stringify(await list.json())).not.toContain(secret);

    // Redaction is response-only: the row keeps the plaintext so the
    // execution path (which reads `task_config` directly) still works.
    // At-rest encryption is tracked as remaining (FIX-AUDIT-005).
    const row = await db.select().from(cronJobs).where(eq(cronJobs.name, "http-secret")).get();
    expect(row!.taskConfig).toContain(secret);
  });

  test("redacts a secret-typed action input by its declared key", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    registerAction(defineAction({
      spec: {
        name: "secret-probe",
        displayName: "Secret probe",
        description: "test-only action with a secret input",
        category: "custom",
        inputs: [{ key: "apiCredential", label: "API credential", type: "secret", required: true }],
      },
      execute: async () => "ok",
    }));

    const created = await createJob(cookie, {
      name: "with-secret",
      action: "secret-probe",
      config: { apiCredential: "supersecret-value" },
    });
    expect(created.status).toBe(201);

    const body = await created.json() as { data: { taskConfig: Record<string, unknown> } };
    expect(body.data.taskConfig.apiCredential).toBe("[REDACTED]");
    expect(JSON.stringify(body)).not.toContain("supersecret-value");
  });
});

describe("POST /cron/jobs config bounds (FIX-AUDIT-016)", () => {
  test("rejects a config with too many keys (422)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const config: Record<string, number> = {};
    for (let i = 0; i < 51; i++)
      config[`k${i}`] = i;
    const res = await createJob(cookie, { action: "log-cleanup", config });
    expect(res.status).toBe(422);
  });

  test("rejects a config key longer than the limit (422)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await createJob(cookie, { action: "log-cleanup", config: { ["x".repeat(101)]: 1 } });
    expect(res.status).toBe(422);
  });

  test("rejects an oversized config payload (422)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await createJob(cookie, { action: "log-cleanup", config: { blob: "a".repeat(17 * 1024) } });
    expect(res.status).toBe(422);
  });
});

describe("pause / resume", () => {
  test("pause disables the job and resume re-enables it, each audited", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const created = await (await createJob(cookie, { name: "toggle" })).json() as { data: { id: string } };

    const pause = await buildApp().request(`/cron/jobs/${created.data.id}/pause`, { method: "POST", headers: { Cookie: cookie } });
    expect(pause.status).toBe(200);
    expect((await db.select().from(cronJobs).where(eq(cronJobs.id, created.data.id)).get())!.enabled).toBe(false);

    const resume = await buildApp().request(`/cron/jobs/${created.data.id}/resume`, { method: "POST", headers: { Cookie: cookie } });
    expect(resume.status).toBe(200);
    expect((await db.select().from(cronJobs).where(eq(cronJobs.id, created.data.id)).get())!.enabled).toBe(true);

    const paused = await db.select().from(auditEvents).where(eq(auditEvents.action, "cron.job.paused")).get();
    const resumed = await db.select().from(auditEvents).where(eq(auditEvents.action, "cron.job.resumed")).get();
    expect(paused).toBeDefined();
    expect(resumed).toBeDefined();
  });
});

describe("GET /cron/jobs/:id/logs", () => {
  test("returns run history for the job", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const created = await (await createJob(cookie, { name: "with-logs" })).json() as { data: { id: string } };
    await buildApp().request(`/cron/jobs/${created.data.id}/trigger`, { method: "POST", headers: { Cookie: cookie } });

    const res = await buildApp().request(`/cron/jobs/${created.data.id}/logs`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { jobName: string; logs: { status: string }[] } };
    expect(body.data.jobName).toBe("with-logs");
    expect(body.data.logs).toHaveLength(1);
  });

  test("404s for an unknown job", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/cron/jobs/missing/logs", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});
