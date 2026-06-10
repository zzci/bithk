import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { pack as tarPack } from "tar-stream";
import { createDb } from "@/db";
import { auditEvents } from "@/modules/audit/schema";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { __setLocalDriverRootForTests, localDriver } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import { backupBlobRestoreRoutes } from "./blob-restore.routes";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-blob-restore-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  config = testConfig({ DATA_DIR: baseDir });
  registerDriver(localDriver);
  __setLocalDriverRootForTests(resolve(baseDir, "blob-root"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  __resetDriverRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

function app() {
  return mountRoutes(db, [backupBlobRestoreRoutes], config);
}

async function tarGz(entries: { name: string; data: string | Uint8Array }[]): Promise<File> {
  const pack = tarPack();
  const drained = (async () => {
    const out: Buffer[] = [];
    for await (const chunk of pack as AsyncIterable<Buffer>)
      out.push(chunk);
    return Buffer.concat(out);
  })();
  for (const entry of entries)
    pack.entry({ name: entry.name }, Buffer.from(entry.data));
  pack.finalize();
  return new File([Bun.gzipSync(await drained)], "blobs.tar.gz", { type: "application/gzip" });
}

function sha256Of(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

async function upload(cookie: string, file: File | Blob): Promise<Response> {
  const fd = new FormData();
  fd.append("file", file);
  return app().request("/backup/v2/blob-restores", { method: "POST", headers: { Cookie: cookie }, body: fd });
}

describe("auth/admin gating", () => {
  test("401 without a session", async () => {
    const res = await app().request("/backup/v2/blob-restores", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await app().request("/backup/v2/blob-restores", { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
});

describe("POST /backup/v2/blob-restores", () => {
  test("200 with the result report and a backup.import.blobs audit row", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "admin");
    const bytes = new TextEncoder().encode("route blob bytes");
    const res = await upload(cookie, await tarGz([{ name: `blobs/${deriveStorageKey(sha256Of(bytes))}`, data: bytes }]));
    expect(res.status).toBe(200);
    const body = await res.json() as { report: { written: number; skippedExisting: number; failed: number; reconcile: { checked: number; quarantined: number } } };
    expect(body.report).toMatchObject({ written: 1, skippedExisting: 0, failed: 0 });
    expect(await localDriver.exists(deriveStorageKey(sha256Of(bytes)))).toBe(true);

    const auditRow = await db.select().from(auditEvents).where(eq(auditEvents.action, "backup.import.blobs")).get();
    expect(auditRow).toBeDefined();
    expect(auditRow!.actorId).toBe(userId);
    expect(JSON.parse(auditRow!.detail!)).toMatchObject({ written: 1 });
  });

  test("400 NO_FILE without a file part", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const fd = new FormData();
    fd.append("note", "no file");
    const res = await app().request("/backup/v2/blob-restores", { method: "POST", headers: { Cookie: cookie }, body: fd });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("NO_FILE");
  });

  test("400 ARCHIVE_TOO_LARGE from the Content-Length pre-check alone", async () => {
    config = testConfig({ DATA_DIR: baseDir, BACKUP_IMPORT_MAX_ARCHIVE_BYTES: 1024 });
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app().request("/backup/v2/blob-restores", {
      method: "POST",
      headers: { "Cookie": cookie, "Content-Length": String(10 * 1024 * 1024) },
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("ARCHIVE_TOO_LARGE");
  });

  test("400 with a cross-endpoint hint when a DATA archive is uploaded", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await upload(cookie, await tarGz([
      { name: "manifest.json", data: "{}" },
      { name: "data/settings.ndjson", data: "" },
    ]));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("MALFORMED_ARCHIVE");
    expect(body.error.message).toContain("/api/backup/v2/imports");
  });
});
