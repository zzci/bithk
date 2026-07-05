import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { stubLogger, testConfig, testNanoid } from "@/shared/test/route-harness";
import {
  __resetExportJobsForTests,
  cancelOrDiscardExportJob,
  finalizeDownloadedExport,
  findRunningExportJob,
  getBackupStagingRoot,
  getDownloadableArchive,
  getExportJob,
  startBackupStagingSweep,
  startExportJob,
  stopBackupStagingSweep,
  sweepBackupStaging,
} from "./export-job.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-job-${Date.now()}-${testNanoid()}`);
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

describe("export job lifecycle", () => {
  test("runs pending → running → completed and stages the archive", async () => {
    const job = startExportJob(db, config, { modules: ["settings"] });
    expect(["pending", "running"]).toContain(job.state);
    expect(findRunningExportJob()?.id).toBe(job.id);

    await job.done;
    expect(job.state).toBe("completed");
    expect(job.error).toBeUndefined();
    expect(job.artifacts!.data.path).toBe(resolve(getBackupStagingRoot(config), "exports", job.id, "archive.tar.gz"));
    expect(existsSync(job.artifacts!.data.path)).toBe(true);
    expect(job.artifacts!.data.size).toBeGreaterThan(0);
    // Non-separate jobs have exactly one artifact.
    expect(job.artifacts!.blobs).toBeUndefined();
    expect(job.progress.tablesDone).toBe(job.progress.tablesTotal);
    expect(findRunningExportJob()).toBeUndefined();
  });

  test("records the owner bucket and redacted flag; defaults to an admin job", async () => {
    const admin = startExportJob(db, config, { modules: ["settings"] });
    expect(admin.ownerBucket).toBeUndefined();
    expect(admin.redacted).toBe(false);
    await admin.done;
    expect(admin.manifest!.redacted).toBe(false);

    const token = startExportJob(db, config, { modules: ["settings"], ownerBucket: "t:bucket01", redacted: true });
    expect(token.ownerBucket).toBe("t:bucket01");
    expect(token.redacted).toBe(true);
    await token.done;
    expect(token.manifest!.redacted).toBe(true);
  });

  test("a second start while one is pending/running throws 409", async () => {
    const first = startExportJob(db, config, { modules: ["settings"] });
    expect(() => startExportJob(db, config, { modules: ["settings"] }))
      .toThrow("Another backup export job is already in progress.");
    await first.done;
    // Completed jobs do not block a new trigger.
    const second = startExportJob(db, config, { modules: ["settings"] });
    await second.done;
    expect(second.state).toBe("completed");
  });

  test("download-then-cleanup: finalize removes staging and forgets the job", async () => {
    const job = startExportJob(db, config, { modules: ["settings"] });
    await job.done;

    const archive = getDownloadableArchive(job.id);
    expect(archive?.path).toBe(job.artifacts!.data.path);
    expect(archive?.size).toBe(job.artifacts!.data.size);

    finalizeDownloadedExport(job.id);
    expect(existsSync(job.stagingDir)).toBe(false);
    expect(getExportJob(job.id)).toBeUndefined();
    expect(getDownloadableArchive(job.id)).toBeUndefined();
  });

  test("FIX-062: every job is external — a single data artifact, no blobs artifact", async () => {
    const job = startExportJob(db, config, { modules: ["settings"] });
    await job.done;
    expect(job.state).toBe("completed");
    expect(job.blobsMode).toBe("external");
    expect(job.artifacts!.blobs).toBeUndefined();
    expect(getDownloadableArchive(job.id, "blobs")).toBeUndefined();
    // Finalizing a missing artifact is a no-op, not a cleanup.
    finalizeDownloadedExport(job.id, "blobs");
    expect(getExportJob(job.id)).toBeDefined();

    // Downloading the data artifact completes the lifecycle.
    finalizeDownloadedExport(job.id, "data");
    expect(existsSync(job.stagingDir)).toBe(false);
    expect(getExportJob(job.id)).toBeUndefined();
  });

  test("the archive is not downloadable until completed", () => {
    const job = startExportJob(db, config, { modules: ["settings"] });
    // Synchronously after start the job has not completed — no download.
    expect(getDownloadableArchive(job.id)).toBeUndefined();
  });

  test("cancel/discard removes staging and the job", async () => {
    const job = startExportJob(db, config, { modules: ["settings", "users"] });
    job.cancelRequested = true;
    const removed = await cancelOrDiscardExportJob(job.id);
    expect(removed).toBe(true);
    expect(existsSync(job.stagingDir)).toBe(false);
    expect(getExportJob(job.id)).toBeUndefined();
    expect(await cancelOrDiscardExportJob(job.id)).toBe(false);
  });

  test("a failing job lands in failed with staging removed", async () => {
    // Force mkdir to fail: a regular FILE occupies the staging root path.
    const brokenDataDir = resolve(baseDir, "broken");
    mkdirSync(brokenDataDir, { recursive: true });
    writeFileSync(resolve(brokenDataDir, "backup-staging"), "not a directory");
    const brokenConfig = testConfig({ DATA_DIR: brokenDataDir, BACKUP_STAGING_TTL_HOURS: 24 });

    const job = startExportJob(db, brokenConfig, { modules: ["settings"] }, stubLogger);
    await job.done;
    expect(job.state).toBe("failed");
    expect(job.error).toBeTruthy();
    expect(getDownloadableArchive(job.id)).toBeUndefined();
  });
});

describe("TTL sweep", () => {
  test("removes expired entries across subtrees, keeps fresh ones", () => {
    const root = getBackupStagingRoot(config);
    const oldExport = resolve(root, "exports", "old-job");
    const freshExport = resolve(root, "exports", "fresh-job");
    const oldImport = resolve(root, "imports", "old-upload");
    const strayFile = resolve(root, "stray.partial");
    mkdirSync(oldExport, { recursive: true });
    mkdirSync(freshExport, { recursive: true });
    mkdirSync(oldImport, { recursive: true });
    writeFileSync(resolve(oldExport, "archive.tar.gz.partial"), "debris");
    writeFileSync(strayFile, "debris");

    // Inject an expired mtime (25h) on the old entries; TTL is 24h.
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(oldExport, old, old);
    utimesSync(oldImport, old, old);
    utimesSync(strayFile, old, old);

    const removed = sweepBackupStaging(root, 24);
    expect(removed).toBe(3);
    expect(existsSync(oldExport)).toBe(false);
    expect(existsSync(oldImport)).toBe(false);
    expect(existsSync(strayFile)).toBe(false);
    expect(existsSync(freshExport)).toBe(true);
  });

  test("no-ops on a missing root", () => {
    expect(sweepBackupStaging(resolve(baseDir, "does-not-exist"), 24)).toBe(0);
  });

  test("startBackupStagingSweep sweeps orphans immediately on boot and is idempotent", () => {
    const root = getBackupStagingRoot(config);
    const orphan = resolve(root, "exports", "crashed-job");
    mkdirSync(orphan, { recursive: true });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(orphan, old, old);

    startBackupStagingSweep(config, stubLogger);
    expect(existsSync(orphan)).toBe(false);
    startBackupStagingSweep(config, stubLogger); // second call no-ops
    stopBackupStagingSweep();
  });
});
