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
    const job = startExportJob(db, config, { modules: ["settings"], includeBlobs: false });
    expect(["pending", "running"]).toContain(job.state);
    expect(findRunningExportJob()?.id).toBe(job.id);

    await job.done;
    expect(job.state).toBe("completed");
    expect(job.error).toBeUndefined();
    expect(job.archivePath).toBe(resolve(getBackupStagingRoot(config), "exports", job.id, "archive.tar.gz"));
    expect(existsSync(job.archivePath!)).toBe(true);
    expect(job.archiveSize).toBeGreaterThan(0);
    expect(job.progress.tablesDone).toBe(job.progress.tablesTotal);
    expect(findRunningExportJob()).toBeUndefined();
  });

  test("a second start while one is pending/running throws 409", async () => {
    const first = startExportJob(db, config, { modules: ["settings"], includeBlobs: false });
    expect(() => startExportJob(db, config, { modules: ["settings"], includeBlobs: false }))
      .toThrow("Another backup export job is already in progress.");
    await first.done;
    // Completed jobs do not block a new trigger.
    const second = startExportJob(db, config, { modules: ["settings"], includeBlobs: false });
    await second.done;
    expect(second.state).toBe("completed");
  });

  test("download-then-cleanup: finalize removes staging and forgets the job", async () => {
    const job = startExportJob(db, config, { modules: ["settings"], includeBlobs: false });
    await job.done;

    const archive = getDownloadableArchive(job.id);
    expect(archive?.path).toBe(job.archivePath!);
    expect(archive?.size).toBe(job.archiveSize!);

    finalizeDownloadedExport(job.id);
    expect(existsSync(job.stagingDir)).toBe(false);
    expect(getExportJob(job.id)).toBeUndefined();
    expect(getDownloadableArchive(job.id)).toBeUndefined();
  });

  test("the archive is not downloadable until completed", () => {
    const job = startExportJob(db, config, { modules: ["settings"], includeBlobs: false });
    // Synchronously after start the job has not completed — no download.
    expect(getDownloadableArchive(job.id)).toBeUndefined();
  });

  test("cancel/discard removes staging and the job", async () => {
    const job = startExportJob(db, config, { modules: ["settings", "users"], includeBlobs: false });
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

    const job = startExportJob(db, brokenConfig, { modules: ["settings"], includeBlobs: false }, stubLogger);
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
