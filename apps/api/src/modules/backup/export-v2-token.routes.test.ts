import type { BackupManifestV2 } from "./archive.service";
import type { ExportJob } from "./export-job.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { extract as tarExtract } from "tar-stream";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { auditEvents } from "@/modules/audit/schema";
import { cronBackupContribution } from "@/modules/cron/cron.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import {
  __resetExportJobsForTests,
  __setExportJobForTests,
  getBackupStagingRoot,
  getExportJob,
  startExportJob,
} from "./export-job.service";
import { backupExportV2TokenRoutes } from "./export-v2-token.routes";
import { backupExportV2Routes } from "./export-v2.routes";
import { backupExportInFlight, tokenBucketKey } from "./export.routes";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-v2-token-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
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

/** Token routes mount first, like the live aggregator (`backup.routes.ts`). */
function app(config: Config) {
  return mountRoutes(db, [backupExportV2TokenRoutes, backupExportV2Routes], config);
}

function configWithToken(token: string, overrides: Partial<Config> = {}): Config {
  return testConfig({
    SERVICE_TOKEN_BACKUP: token,
    BACKUP_EXPORT_MIN_INTERVAL_SECONDS: 0,
    DATA_DIR: baseDir,
    BACKUP_STAGING_TTL_HOURS: 24,
    ...overrides,
  });
}

async function triggerViaToken(config: Config, token: string, body: Record<string, unknown> = { modules: ["settings"] }): Promise<Response> {
  return app(config).request("/backup/v2/exports-via-token", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Trigger a token export and wait for its background runner to settle. */
async function createCompletedTokenJob(config: Config, token: string, body: Record<string, unknown> = { modules: ["settings"] }): Promise<string> {
  const res = await triggerViaToken(config, token, body);
  expect(res.status).toBe(202);
  const { jobId } = await res.json() as { jobId: string };
  await getExportJob(jobId)!.done;
  expect(getExportJob(jobId)!.state).toBe("completed");
  return jobId;
}

interface ArchiveEntry { name: string; data: Buffer }

/** Gunzip + untar a body/file stream, preserving entry order. */
async function readArchiveStream(gz: ReadableStream<Uint8Array>): Promise<ArchiveEntry[]> {
  const ex = tarExtract();
  const entries: ArchiveEntry[] = [];
  ex.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (d: Buffer) => chunks.push(d));
    stream.on("end", () => {
      entries.push({ name: header.name, data: Buffer.concat(chunks) });
      next();
    });
  });
  const finished = new Promise<void>((res, rej) => {
    ex.on("finish", res);
    ex.on("error", rej);
  });
  // Cast: lib.dom types DecompressionStream's writable as
  // WritableStream<BufferSource>, which pipeThrough's Uint8Array generic
  // rejects; the runtime accepts Uint8Array chunks fine.
  const gunzip = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const plain = gz.pipeThrough(gunzip);
  for await (const chunk of plain) {
    if (!ex.write(Buffer.from(chunk)))
      await once(ex, "drain");
  }
  ex.end();
  await finished;
  return entries;
}

function parseNdjson(entry: ArchiveEntry): Record<string, unknown>[] {
  return entry.data.toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
}

async function insertSecretCronJob(secret: string): Promise<void> {
  registerBackupContribution(cronBackupContribution);
  await db.run(sql`
    INSERT INTO cron_jobs (id, name, cron, task_type, task_config, enabled, is_deleted, max_consecutive_failures, created_at, updated_at)
    VALUES ('job-1', 'nightly', '0 0 * * *', 'http_request', ${JSON.stringify({ url: "https://x", headers: { authorization: secret } })}, 1, 0, 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  `);
}

describe("token auth gating", () => {
  test("503 when no service token is configured", async () => {
    const res = await app(testConfig({ DATA_DIR: baseDir })).request("/backup/v2/exports-via-token", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
    });
    expect(res.status).toBe(503);
  });

  test("401 with a missing or wrong bearer token on every route", async () => {
    const config = configWithToken("v2tok-auth-aaaaaaaa");
    const paths = [
      { method: "POST", path: "/backup/v2/exports-via-token" },
      { method: "GET", path: "/backup/v2/exports/some-id/status-via-token" },
      { method: "GET", path: "/backup/v2/exports/some-id/download-via-token" },
    ];
    for (const r of paths) {
      const noTok = await app(config).request(r.path, { method: r.method });
      expect(noTok.status).toBe(401);
      const wrong = await app(config).request(r.path, {
        method: r.method,
        headers: { Authorization: "Bearer wrong-but-same-len!!" },
      });
      expect(wrong.status).toBe(401);
    }
  });
});

describe("POST /backup/v2/exports-via-token", () => {
  test("403 SCOPE_REQUIRED when the request carries no module scope (fail closed)", async () => {
    const token = "v2tok-scope-bbbbbbbb";
    const config = configWithToken(token);

    // No body at all → unscoped → reject.
    const noBody = await app(config).request("/backup/v2/exports-via-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(noBody.status).toBe(403);
    const noBodyJson = await noBody.json() as { error: { code: string } };
    expect(noBodyJson.error.code).toBe("SCOPE_REQUIRED");

    // Empty module list → still unscoped → reject.
    const emptyList = await triggerViaToken(config, token, { modules: [] });
    expect(emptyList.status).toBe(403);

    // No job started, no success audit row.
    const successRow = await db.select().from(auditEvents).where(eq(auditEvents.result, "success")).get();
    expect(successRow).toBeUndefined();
    const failureRow = await db.select().from(auditEvents).where(eq(auditEvents.result, "failure")).get();
    expect(failureRow!.action).toBe("backup.export");
  });

  test("400 INVALID_MODULES when a scoped token names an unknown module", async () => {
    const token = "v2tok-badmod-cccccccc";
    const res = await triggerViaToken(configWithToken(token), token, { modules: ["settings", "nope"] });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_MODULES");
  });

  test("202 starts a redacted, bucket-owned job and audits via:token", async () => {
    const token = "v2tok-happy-dddddddd";
    const config = configWithToken(token);
    // FIX-062: a legacy `blobs` field from an older sidecar is ignored.
    const res = await triggerViaToken(config, token, { modules: ["settings"], blobs: "none" });
    expect(res.status).toBe(202);
    const { jobId } = await res.json() as { jobId: string };

    const job = getExportJob(jobId)!;
    expect(job.ownerBucket).toBe(tokenBucketKey(token));
    expect(job.redacted).toBe(true);
    expect(job.blobsMode).toBe("external");

    const auditRow = await db.select().from(auditEvents).get();
    expect(auditRow!.action).toBe("backup.export");
    expect(auditRow!.actorId).toBe("system");
    expect(JSON.parse(auditRow!.detail!)).toEqual({ modules: ["settings"], blobs: "external", via: "token", redacted: true });

    await job.done;
    expect(job.manifest!.redacted).toBe(true);
  });

  test("rejects a parallel trigger for the same token bucket (429)", async () => {
    const token = "v2tok-inflight-eeeeeeee";
    const config = configWithToken(token);
    // Pin the v1-shared semaphore directly — deterministic regardless of
    // how fast the background runner finishes.
    backupExportInFlight.add(tokenBucketKey(token));
    try {
      const res = await triggerViaToken(config, token);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe("RATE_LIMITED");
    }
    finally {
      backupExportInFlight.delete(tokenBucketKey(token));
    }
  });

  test("releases the semaphore when the job settles; min-interval then throttles (429)", async () => {
    const token = "v2tok-throttle-ffffffff";
    const config = configWithToken(token, { BACKUP_EXPORT_MIN_INTERVAL_SECONDS: 3600 });

    await createCompletedTokenJob(config, token);
    // The runner settled → the in-flight marker is released; the SECOND
    // trigger therefore hits the min-interval gate, not the semaphore.
    expect(backupExportInFlight.has(tokenBucketKey(token))).toBe(false);

    const second = await triggerViaToken(config, token);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    const body = await second.json() as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  test("409 EXPORT_IN_PROGRESS while an admin job is running (process-wide guard)", async () => {
    const token = "v2tok-guard-gggggggg";
    const config = configWithToken(token);
    const synthetic: ExportJob = {
      id: `synthetic-${testNanoid()}`,
      state: "running",
      modules: ["settings"],
      blobsMode: "external",
      redacted: false,
      createdAt: new Date().toISOString(),
      stagingDir: resolve(getBackupStagingRoot(config), "exports", "synthetic"),
      progress: { tablesDone: 0, tablesTotal: 1, blobBytesDone: 0, blobBytesTotal: 0 },
      cancelRequested: false,
      done: Promise.resolve(),
    };
    __setExportJobForTests(synthetic);

    const res = await triggerViaToken(config, token);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("EXPORT_IN_PROGRESS");
  });
});

describe("job visibility isolation", () => {
  test("a token cannot see an admin job (404 on status and download)", async () => {
    const token = "v2tok-isoadmin-hhhhhhhh";
    const config = configWithToken(token);
    const adminJob = startExportJob(db, config, { modules: ["settings"] });
    await adminJob.done;

    const status = await app(config).request(`/backup/v2/exports/${adminJob.id}/status-via-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status.status).toBe(404);
    const download = await app(config).request(`/backup/v2/exports/${adminJob.id}/download-via-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(404);
    // The admin job is untouched by the failed token download attempt.
    expect(getExportJob(adminJob.id)).toBeDefined();
  });

  test("a second token bucket cannot see the first bucket's job", async () => {
    const token = "v2tok-isobucket-iiiiiiii";
    const config = configWithToken(token);
    // A job owned by a DIFFERENT bucket (only one token is configurable at
    // runtime, so the foreign bucket is seeded directly).
    const foreign = startExportJob(db, config, { modules: ["settings"], ownerBucket: "t:other_bu", redacted: true });
    await foreign.done;

    const status = await app(config).request(`/backup/v2/exports/${foreign.id}/status-via-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status.status).toBe(404);
    const download = await app(config).request(`/backup/v2/exports/${foreign.id}/download-via-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(404);
  });

  test("a token job stays visible to admin via the existing admin routes", async () => {
    const token = "v2tok-adminsees-jjjjjjjj";
    const config = configWithToken(token);
    const jobId = await createCompletedTokenJob(config, token);

    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app(config).request(`/backup/v2/exports/${jobId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { jobId: string; state: string };
    expect(body.jobId).toBe(jobId);
    expect(body.state).toBe("completed");
  });

  test("status-via-token reports the own-bucket job in the admin poll shape", async () => {
    const token = "v2tok-status-kkkkkkkk";
    const config = configWithToken(token);
    const jobId = await createCompletedTokenJob(config, token);

    const res = await app(config).request(`/backup/v2/exports/${jobId}/status-via-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      jobId: string;
      state: string;
      blobsMode: string;
      progress: { tablesDone: number; tablesTotal: number };
      error: string | null;
      archiveSize: number | null;
      warnings: string[] | null;
      artifacts: { data: { size: number; downloaded: boolean } } | null;
    };
    expect(body.jobId).toBe(jobId);
    expect(body.state).toBe("completed");
    expect(body.blobsMode).toBe("external");
    expect(body.progress.tablesDone).toBe(body.progress.tablesTotal);
    expect(body.error).toBeNull();
    expect(body.archiveSize).toBeGreaterThan(0);
    // Admin-route parity: manifest warnings appear once completed.
    expect(body.warnings).toEqual([]);
    expect(body.artifacts!.data.downloaded).toBe(false);
  });
});

describe("GET /backup/v2/exports/:jobId/download-via-token", () => {
  test("streams the REDACTED archive and audits the download; admin export stays unredacted", async () => {
    const token = "v2tok-redact-llllllll";
    const config = configWithToken(token);
    const secret = "Bearer super-secret-xyz-do-not-leak";
    await insertSecretCronJob(secret);

    const jobId = await createCompletedTokenJob(config, token, { modules: ["cron"] });
    const res = await app(config).request(`/backup/v2/exports/${jobId}/download-via-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const entries = await readArchiveStream(res.body!);
    expect(entries[0]!.name).toBe("manifest.json");
    const manifest = JSON.parse(entries[0]!.data.toString("utf8")) as BackupManifestV2;
    expect(manifest.redacted).toBe(true);
    // The plaintext secret must never appear anywhere in the artifact.
    expect(entries.some(e => e.data.includes("super-secret-xyz"))).toBe(false);
    const rows = parseNdjson(entries.find(e => e.name === "data/cron_jobs.ndjson")!);
    expect(rows.find(r => r.id === "job-1")!.taskConfig).toBe("[REDACTED]");

    // Drained → downloaded lifecycle fires exactly like the admin route.
    expect(getExportJob(jobId)).toBeUndefined();

    const downloadRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.export.download")).get();
    expect(downloadRow!.actorId).toBe("system");
    expect(JSON.parse(downloadRow!.detail!)).toEqual({ jobId, artifact: "data", via: "token" });

    // Parity check: the ADMIN export of the same data stays unredacted.
    const adminJob = startExportJob(db, config, { modules: ["cron"] });
    await adminJob.done;
    expect(adminJob.manifest!.redacted).toBe(false);
    const adminEntries = await readArchiveStream(Bun.file(adminJob.artifacts!.data.path).stream());
    const adminRows = parseNdjson(adminEntries.find(e => e.name === "data/cron_jobs.ndjson")!);
    expect(adminRows.find(r => r.id === "job-1")!.taskConfig).toContain("super-secret-xyz");
  });

  test("an unknown artifact selector is a 400", async () => {
    const token = "v2tok-artifact-mmmmmmmm";
    const config = configWithToken(token);
    const jobId = await createCompletedTokenJob(config, token);

    const bad = await app(config).request(`/backup/v2/exports/${jobId}/download-via-token?artifact=nope`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_ARTIFACT");
    expect(getExportJob(jobId)).toBeDefined();
  });

  test("artifact=blobs is a 400 — token jobs no longer produce a blobs artifact", async () => {
    const token = "v2tok-noblobs-nnnnnnnn";
    const config = configWithToken(token);
    const jobId = await createCompletedTokenJob(config, token);
    const res = await app(config).request(`/backup/v2/exports/${jobId}/download-via-token?artifact=blobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NO_BLOBS_ARTIFACT");
    expect(getExportJob(jobId)).toBeDefined();
  });
});
