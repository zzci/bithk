import type { BackupManifestV2 } from "./archive.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { pack as tarPack } from "tar-stream";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { auditEvents } from "@/modules/audit/schema";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import { backupImportV2Routes } from "./import-v2.routes";
import { __resetImportJobsForTests, getImportJob } from "./import.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-import-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  config = testConfig({ DATA_DIR: baseDir });
  __resetBackupRegistryForTests();
  __resetImportJobsForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  __resetImportJobsForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

function app() {
  return mountRoutes(db, [backupImportV2Routes], config);
}

function manifest(): BackupManifestV2 {
  return {
    format: "bithk-backup",
    formatVersion: 2,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: { lastIdx: 0, lastTag: "0000_test", entryCount: 1 } },
    redacted: false,
    includeBlobs: false,
    modules: [{ name: "settings", deps: [] }],
    tables: [{
      name: "settings",
      module: "settings",
      file: "data/settings.ndjson",
      rowCount: 1,
      primaryKey: ["key"],
      columns: [
        { name: "key", type: "text", notNull: true },
        { name: "value", type: "text", notNull: true },
        { name: "updatedBy", type: "text", notNull: false },
        { name: "updatedAt", type: "text", notNull: true },
      ],
    }],
    blobs: { count: 0, totalBytes: 0 },
    warnings: [],
  };
}

async function validArchive(): Promise<File> {
  const pack = tarPack();
  const drained = (async () => {
    const out: Buffer[] = [];
    for await (const chunk of pack as AsyncIterable<Buffer>)
      out.push(chunk);
    return Buffer.concat(out);
  })();
  pack.entry({ name: "manifest.json" }, JSON.stringify(manifest()));
  pack.entry({ name: "data/settings.ndjson" }, `${JSON.stringify({ key: "k1", value: "v1", updatedBy: null, updatedAt: "2026-01-01T00:00:00Z" })}\n`);
  pack.finalize();
  return new File([Bun.gzipSync(await drained)], "backup.tar.gz", { type: "application/gzip" });
}

async function upload(cookie: string, file: File | Blob): Promise<Response> {
  const fd = new FormData();
  fd.append("file", file);
  return app().request("/backup/v2/imports", { method: "POST", headers: { Cookie: cookie }, body: fd });
}

interface UploadBody {
  importId: string;
  report: { totals: { inserted: number; skippedDuplicate: number; failed: number; transformed: number } };
}

describe("auth/admin gating", () => {
  const routes = [
    { method: "POST", path: "/backup/v2/imports" },
    { method: "GET", path: "/backup/v2/imports/some-id" },
    { method: "DELETE", path: "/backup/v2/imports/some-id" },
  ];

  test("401 without a session on every route", async () => {
    for (const r of routes) {
      const res = await app().request(r.path, { method: r.method });
      expect(res.status).toBe(401);
    }
  });

  test("403 for a non-admin user on every route", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    for (const r of routes) {
      const res = await app().request(r.path, { method: r.method, headers: { Cookie: cookie } });
      expect(res.status).toBe(403);
    }
  });
});

describe("POST /backup/v2/imports", () => {
  test("201 with importId + dry-run report, audits backup.import.validate, writes nothing", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const settingsBefore = await db.all(sql`SELECT * FROM settings`);

    const res = await upload(cookie, await validArchive());
    expect(res.status).toBe(201);
    const body = await res.json() as UploadBody;
    expect(body.importId).toBeTruthy();
    expect(body.report.totals).toEqual({ inserted: 1, skippedDuplicate: 0, failed: 0, transformed: 0 });

    // Dry-run only — live data untouched, staged archive intact.
    expect(await db.all(sql`SELECT * FROM settings`)).toEqual(settingsBefore);
    const job = getImportJob(body.importId)!;
    expect(job.state).toBe("validated");
    expect(existsSync(job.archivePath)).toBe(true);

    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.validate")).get();
    expect(auditRow!.actorId).toBe(userId);
    const detail = JSON.parse(auditRow!.detail!) as { importId: string; modules: string[] };
    expect(detail.importId).toBe(body.importId);
    expect(detail.modules).toEqual(["settings"]);
  });

  test("400 NO_FILE without a file part", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const fd = new FormData();
    fd.append("note", "no file here");
    const res = await app().request("/backup/v2/imports", { method: "POST", headers: { Cookie: cookie }, body: fd });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NO_FILE");
  });

  test("400 MALFORMED_ARCHIVE for bytes that are not a gzipped tar", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await upload(cookie, new File([new Uint8Array(64).fill(7)], "x.tar.gz"));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("MALFORMED_ARCHIVE");
  });

  test("400 ARCHIVE_TOO_LARGE when the upload exceeds the configured cap (counted bytes beat a lying Content-Length)", async () => {
    config = testConfig({ DATA_DIR: baseDir, BACKUP_IMPORT_MAX_ARCHIVE_BYTES: 32 });
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await upload(cookie, await validArchive());
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("ARCHIVE_TOO_LARGE");
  });

  test("400 ARCHIVE_TOO_LARGE from the Content-Length pre-check alone", async () => {
    config = testConfig({ DATA_DIR: baseDir, BACKUP_IMPORT_MAX_ARCHIVE_BYTES: 1024 });
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/imports", {
      method: "POST",
      headers: { "Cookie": cookie, "Content-Length": String(10 * 1024 * 1024) },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("ARCHIVE_TOO_LARGE");
  });

  test("400 UNSUPPORTED_VERSION for a newer-format archive", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const pack = tarPack();
    const drained = (async () => {
      const out: Buffer[] = [];
      for await (const chunk of pack as AsyncIterable<Buffer>)
        out.push(chunk);
      return Buffer.concat(out);
    })();
    pack.entry({ name: "manifest.json" }, JSON.stringify({ ...manifest(), formatVersion: 99 }));
    pack.finalize();
    const res = await upload(cookie, new File([Bun.gzipSync(await drained)], "x.tar.gz"));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("UNSUPPORTED_VERSION");
  });
});

describe("GET /backup/v2/imports/:importId", () => {
  test("404 for an unknown import", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/imports/nope", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("returns state + report for a staged import", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const uploaded = await upload(cookie, await validArchive());
    const { importId } = await uploaded.json() as UploadBody;

    const res = await app().request(`/backup/v2/imports/${importId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { importId: string; state: string; report: UploadBody["report"]; error: string | null };
    expect(body.importId).toBe(importId);
    expect(body.state).toBe("validated");
    expect(body.report.totals.inserted).toBe(1);
    expect(body.error).toBeNull();
  });
});

describe("DELETE /backup/v2/imports/:importId", () => {
  test("404 for an unknown import", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/imports/nope", { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("discards the staged import without applying", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const uploaded = await upload(cookie, await validArchive());
    const { importId } = await uploaded.json() as UploadBody;
    const stagingDir = getImportJob(importId)!.stagingDir;
    expect(existsSync(stagingDir)).toBe(true);

    const res = await app().request(`/backup/v2/imports/${importId}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(existsSync(stagingDir)).toBe(false);
    expect(getImportJob(importId)).toBeUndefined();

    const again = await app().request(`/backup/v2/imports/${importId}`, { headers: { Cookie: cookie } });
    expect(again.status).toBe(404);
    // Discard never wrote to live data.
    expect(await db.all(sql`SELECT * FROM settings`)).toHaveLength(0);
  });
});
