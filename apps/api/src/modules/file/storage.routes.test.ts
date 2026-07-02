import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { getSetting } from "@/modules/settings/settings.service";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import { STORAGE_SETTING_KEYS } from "./storage-config";
import { storageRoutes } from "./storage.routes";
import { setDbDriverDatabase } from "./storage/db";
import { __setLocalDriverRootForTests } from "./storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "./storage/registry";
import { __resetS3DriverForTests } from "./storage/s3";
// Side-effect import: register the auth provider so the session cookie resolves.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

const config = testConfig();

function buildApp() {
  return mountRoutes(db, [storageRoutes], config);
}

async function jsonReq(app: ReturnType<typeof buildApp>, method: string, path: string, cookie?: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...cookie ? { Cookie: cookie } : {},
    },
    ...body !== undefined ? { body: JSON.stringify(body) } : {},
  });
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-storage-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  // Drop any S3 client a sibling suite built in this shared process so
  // `isS3Configured()` reflects THIS test's state.
  __resetS3DriverForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setDbDriverDatabase(db);
  setActiveDriver("local");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("admin required", () => {
  test("GET /admin/storage/config rejects a non-admin (403) and unauthenticated (401)", async () => {
    const app = buildApp();
    const anon = await app.request("/admin/storage/config");
    expect(anon.status).toBe(401);

    const { cookie } = await sessionCookieFor(db, "user");
    const nonAdmin = await app.request("/admin/storage/config", { headers: { Cookie: cookie } });
    expect(nonAdmin.status).toBe(403);
  });

  test("all storage routes require admin", async () => {
    const app = buildApp();
    const { cookie } = await sessionCookieFor(db, "user");
    for (const [method, path] of [["GET", "/admin/storage/files"], ["POST", "/admin/storage/sync-to-s3"], ["PUT", "/admin/storage/config"]] as const) {
      const res = await jsonReq(app, method, path, cookie, method === "PUT" ? { uploadDriver: "local" } : undefined);
      expect(res.status).toBe(403);
    }
  });
});

describe("GET /admin/storage/config", () => {
  test("returns defaults with secretConfigured=false and never the secret", async () => {
    const app = buildApp();
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await app.request("/admin/storage/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { uploadDriver: string; s3: { secretConfigured: boolean; bucket: string } } };
    expect(body.data.uploadDriver).toBe("local");
    expect(body.data.s3.secretConfigured).toBe(false);
    expect(body.data.s3).not.toHaveProperty("secret");
  });
});

describe("PUT /admin/storage/config", () => {
  test("saving s3 requires bucket + accessKeyId + secret", async () => {
    const app = buildApp();
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await jsonReq(app, "PUT", "/admin/storage/config", cookie, { uploadDriver: "s3", s3: { bucket: "", accessKeyId: "", secret: "" } });
    expect(res.status).toBe(400);
  });

  test("writes s3 params + secret; a later PUT with omitted secret preserves it", async () => {
    const app = buildApp();
    const { cookie } = await sessionCookieFor(db, "admin");

    // Configure S3 for local upload driver (so no S3 client build is required),
    // just persisting the params + secret.
    const first = await jsonReq(app, "PUT", "/admin/storage/config", cookie, {
      uploadDriver: "local",
      s3: { bucket: "b", region: "auto", endpoint: "https://e", accessKeyId: "AK", secret: "topsecret", prefix: "p" },
    });
    expect(first.status).toBe(200);
    expect(await getSetting(db, STORAGE_SETTING_KEYS.s3Secret)).toBe("topsecret");
    expect(await getSetting(db, STORAGE_SETTING_KEYS.s3Bucket)).toBe("b");

    // Second PUT omits the secret → the stored secret is preserved, bucket updated.
    const second = await jsonReq(app, "PUT", "/admin/storage/config", cookie, {
      uploadDriver: "local",
      s3: { bucket: "b2" },
    });
    expect(second.status).toBe(200);
    expect(await getSetting(db, STORAGE_SETTING_KEYS.s3Secret)).toBe("topsecret");
    expect(await getSetting(db, STORAGE_SETTING_KEYS.s3Bucket)).toBe("b2");

    // GET reflects the new bucket and secretConfigured=true, no secret value.
    const get = await app.request("/admin/storage/config", { headers: { Cookie: cookie } });
    const body = await get.json() as { data: { s3: { bucket: string; secretConfigured: boolean } } };
    expect(body.data.s3.bucket).toBe("b2");
    expect(body.data.s3.secretConfigured).toBe(true);
  });
});

describe("POST /admin/storage/sync-to-s3", () => {
  test("400 when S3 is not configured", async () => {
    const app = buildApp();
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await jsonReq(app, "POST", "/admin/storage/sync-to-s3", cookie);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("STORAGE_S3_NOT_CONFIGURED");
  });
});
