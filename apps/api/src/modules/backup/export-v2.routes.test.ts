import type { ExportJob } from "./export-job.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { auditEvents } from "@/modules/audit/schema";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import {
  __resetExportJobsForTests,
  __setExportJobForTests,
  getBackupStagingRoot,
  getExportJob,
} from "./export-job.service";
import { backupExportV2Routes } from "./export-v2.routes";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-v2-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  config = testConfig({ DATA_DIR: baseDir, BACKUP_STAGING_TTL_HOURS: 24 });
  __resetBackupRegistryForTests();
  __resetExportJobsForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  __resetExportJobsForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

function app() {
  return mountRoutes(db, [backupExportV2Routes], config);
}

/** Trigger an export and wait for its background runner to settle. */
async function createCompletedJob(cookie: string, body: Record<string, unknown> = { modules: ["settings"] }): Promise<string> {
  const res = await app().request("/backup/v2/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  const { jobId } = await res.json() as { jobId: string };
  await getExportJob(jobId)!.done;
  return jobId;
}

/** A synthetic running job — pins guard / not-yet-downloadable behaviour. */
function syntheticRunningJob(): ExportJob {
  const job: ExportJob = {
    id: `synthetic-${testNanoid()}`,
    state: "running",
    modules: ["settings"],
    blobsMode: "embedded",
    createdAt: new Date().toISOString(),
    stagingDir: resolve(getBackupStagingRoot(config), "exports", "synthetic"),
    progress: { tablesDone: 0, tablesTotal: 1, blobBytesDone: 0, blobBytesTotal: 0 },
    cancelRequested: false,
    done: Promise.resolve(),
  };
  __setExportJobForTests(job);
  return job;
}

describe("auth/admin gating", () => {
  const routes = [
    { method: "POST", path: "/backup/v2/exports", body: JSON.stringify({ modules: ["settings"] }) },
    { method: "GET", path: "/backup/v2/exports/some-id" },
    { method: "GET", path: "/backup/v2/exports/some-id/download" },
    { method: "DELETE", path: "/backup/v2/exports/some-id" },
  ];

  test("401 without a session on every route", async () => {
    for (const r of routes) {
      const res = await app().request(r.path, {
        method: r.method,
        headers: { "Content-Type": "application/json" },
        ...(r.body ? { body: r.body } : {}),
      });
      expect(res.status).toBe(401);
    }
  });

  test("403 for a non-admin user on every route", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    for (const r of routes) {
      const res = await app().request(r.path, {
        method: r.method,
        headers: { "Content-Type": "application/json", "Cookie": cookie },
        ...(r.body ? { body: r.body } : {}),
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("POST /backup/v2/exports", () => {
  test("202 with a jobId, audits backup.export with via:admin", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: ["settings"], blobs: "none" }),
    });
    expect(res.status).toBe(202);
    const { jobId } = await res.json() as { jobId: string };
    expect(jobId).toBeTruthy();

    const auditRow = await db.select().from(auditEvents).get();
    expect(auditRow!.action).toBe("backup.export");
    expect(auditRow!.actorId).toBe(userId);
    const detail = JSON.parse(auditRow!.detail!) as { modules: string[]; blobs: string; via: string };
    expect(detail).toEqual({ modules: ["settings"], blobs: "none", via: "admin" });

    await getExportJob(jobId)!.done;
    expect(getExportJob(jobId)!.state).toBe("completed");
  });

  test("blobs mode defaults to embedded; the includeBlobs alias still maps", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const modeOf = async (body: Record<string, unknown>): Promise<string> => {
      const jobId = await createCompletedJob(cookie, { modules: ["settings"], ...body });
      return getExportJob(jobId)!.blobsMode;
    };
    expect(await modeOf({})).toBe("embedded");
    expect(await modeOf({ includeBlobs: true })).toBe("embedded");
    expect(await modeOf({ includeBlobs: false })).toBe("none");
    // Explicit `blobs` wins over the deprecated alias when both are sent.
    expect(await modeOf({ blobs: "separate", includeBlobs: false })).toBe("separate");
  });

  test("rejects unknown module names with 400 INVALID_MODULES", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/exports", {
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
    const res = await app().request("/backup/v2/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: [] }),
    });
    expect(res.status).toBe(422);
  });

  test("409 EXPORT_IN_PROGRESS while another job is running", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    syntheticRunningJob();
    const res = await app().request("/backup/v2/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: ["settings"] }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("EXPORT_IN_PROGRESS");
  });
});

describe("GET /backup/v2/exports/:jobId", () => {
  test("404 for an unknown job", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/exports/nope", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("reports state, progress, blobsMode and per-artifact info", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('a', 'b', '2026-01-01T00:00:00Z')`);
    const jobId = await createCompletedJob(cookie);

    const res = await app().request(`/backup/v2/exports/${jobId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      jobId: string;
      state: string;
      blobsMode: string;
      progress: { tablesDone: number; tablesTotal: number };
      error: string | null;
      archiveSize: number | null;
      artifacts: { data: { size: number; downloaded: boolean }; blobs?: { size: number; downloaded: boolean } } | null;
    };
    expect(body.jobId).toBe(jobId);
    expect(body.state).toBe("completed");
    expect(body.blobsMode).toBe("embedded");
    expect(body.progress.tablesDone).toBe(body.progress.tablesTotal);
    expect(body.error).toBeNull();
    expect(body.archiveSize).toBeGreaterThan(0);
    expect(body.artifacts!.data).toEqual({ size: body.archiveSize!, downloaded: false });
    expect(body.artifacts!.blobs).toBeUndefined();
  });

  test("a separate-mode job reports both artifacts", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const jobId = await createCompletedJob(cookie, { modules: ["settings"], blobs: "separate" });

    const res = await app().request(`/backup/v2/exports/${jobId}`, { headers: { Cookie: cookie } });
    const body = await res.json() as {
      blobsMode: string;
      artifacts: { data: { size: number; downloaded: boolean }; blobs?: { size: number; downloaded: boolean } };
    };
    expect(body.blobsMode).toBe("separate");
    expect(body.artifacts.data.size).toBeGreaterThan(0);
    expect(body.artifacts.blobs!.size).toBeGreaterThan(0);
    expect(body.artifacts.blobs!.downloaded).toBe(false);
  });
});

describe("GET /backup/v2/exports/:jobId/download", () => {
  test("404 while the job is still running (.partial is never served)", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const job = syntheticRunningJob();
    const res = await app().request(`/backup/v2/exports/${job.id}/download`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("streams the archive with v1 headers, then cleans up after drain", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const jobId = await createCompletedJob(cookie);
    const stagingDir = getExportJob(jobId)!.stagingDir;

    const res = await app().request(`/backup/v2/exports/${jobId}/download`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain(".tar.gz");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const bytes = new Uint8Array(await res.arrayBuffer());
    // gzip magic — the body is the archive, not an error envelope.
    expect(bytes[0]).toBe(0x1F);
    expect(bytes[1]).toBe(0x8B);

    // Drained → job marked downloaded, staging removed, job forgotten.
    expect(existsSync(stagingDir)).toBe(false);
    expect(getExportJob(jobId)).toBeUndefined();
    const again = await app().request(`/backup/v2/exports/${jobId}/download`, { headers: { Cookie: cookie } });
    expect(again.status).toBe(404);

    const downloadRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.export.download")).get();
    expect(downloadRow!.actorId).toBe(userId);
    expect(JSON.parse(downloadRow!.detail!)).toEqual({ jobId, artifact: "data" });
  });

  test("artifact=blobs on a non-separate job is a 400", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const jobId = await createCompletedJob(cookie); // default = embedded
    const res = await app().request(`/backup/v2/exports/${jobId}/download?artifact=blobs`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NO_BLOBS_ARTIFACT");
    // The job is untouched and the data artifact still downloads.
    expect(getExportJob(jobId)).toBeDefined();
  });

  test("an unknown artifact selector is a 400", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const jobId = await createCompletedJob(cookie);
    const res = await app().request(`/backup/v2/exports/${jobId}/download?artifact=nope`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARTIFACT");
  });

  test("separate mode: staging survives the first download, cleaned after both", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const jobId = await createCompletedJob(cookie, { modules: ["settings"], blobs: "separate" });
    const stagingDir = getExportJob(jobId)!.stagingDir;

    const dataRes = await app().request(`/backup/v2/exports/${jobId}/download`, { headers: { Cookie: cookie } });
    expect(dataRes.status).toBe(200);
    expect(dataRes.headers.get("content-disposition")).not.toContain("blobs");
    await dataRes.arrayBuffer();
    // One of two artifacts downloaded — job and staging must survive.
    expect(getExportJob(jobId)).toBeDefined();
    expect(existsSync(stagingDir)).toBe(true);

    const blobsRes = await app().request(`/backup/v2/exports/${jobId}/download?artifact=blobs`, { headers: { Cookie: cookie } });
    expect(blobsRes.status).toBe(200);
    expect(blobsRes.headers.get("content-disposition")).toContain("-blobs-");
    const bytes = new Uint8Array(await blobsRes.arrayBuffer());
    expect(bytes[0]).toBe(0x1F);
    expect(bytes[1]).toBe(0x8B);

    // Both drained → staging removed, job forgotten.
    expect(existsSync(stagingDir)).toBe(false);
    expect(getExportJob(jobId)).toBeUndefined();
  });
});

describe("DELETE /backup/v2/exports/:jobId", () => {
  test("404 for an unknown job", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/exports/nope", { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("discards a finished job and removes its staging directory", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const jobId = await createCompletedJob(cookie);
    const stagingDir = getExportJob(jobId)!.stagingDir;
    expect(existsSync(stagingDir)).toBe(true);

    const res = await app().request(`/backup/v2/exports/${jobId}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(existsSync(stagingDir)).toBe(false);
    expect(getExportJob(jobId)).toBeUndefined();
  });

  test("cancels an in-flight job via the abort flag", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    // Seed enough rows that the runner spans several await points.
    await db.run(sql`
      WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3000)
      INSERT INTO settings (key, value, updated_at) SELECT 'k' || n, 'v', '2026-01-01T00:00:00Z' FROM c
    `);
    const start = await app().request("/backup/v2/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ modules: ["settings"] }),
    });
    expect(start.status).toBe(202);
    const { jobId } = await start.json() as { jobId: string };
    const stagingDir = getExportJob(jobId)!.stagingDir;

    const res = await app().request(`/backup/v2/exports/${jobId}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(existsSync(stagingDir)).toBe(false);
    expect(getExportJob(jobId)).toBeUndefined();
  });
});
