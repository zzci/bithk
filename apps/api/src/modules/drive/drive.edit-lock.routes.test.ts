import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { policyMiddleware } from "@/modules/policy";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { driveRoutes } from "./drive.routes";
import { uploadDriveFile } from "./drive.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

const config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS"> = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_ATTACHMENTS_PER_RESOURCE: 20,
  UPLOADS_TOTAL_BYTES: 0,
  FILE_GC_MODE: "sync",
  FILE_PRESIGN_ENABLED: false,
  FILE_PRESIGN_TTL_SECONDS: 300,
};

async function seedUser(name = "Alice") {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

function textFile(name: string, body = "v1"): File {
  return new File([body], name, { type: "text/plain" });
}

function personal(userId: string) {
  return { ownerType: "user" as const, ownerId: userId };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-lock-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

// Pre-set `user` from an `x-uid` header so `authRequired` + `policyMiddleware`
// short-circuit on `c.get("user")` without touching the process-global auth
// provider — mirrors the route-test harness in drive.test.ts.
function buildApp() {
  const noopLogger = { error() {}, warn() {}, info() {}, debug() {} } as unknown as AppEnv["Variables"]["logger"];
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", config as unknown as AppEnv["Variables"]["config"]);
    c.set("logger", noopLogger);
    c.set("requestId", "t");
    const uid = c.req.header("x-uid");
    if (uid) {
      const u = await db.select().from(users).where(eq(users.id, uid)).get();
      if (u)
        c.set("user", u);
    }
    await next();
  });
  app.use("*", policyMiddleware({ basePath: "" }));
  app.route("/", driveRoutes());
  app.onError((err, c) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json({ success: false }, status as 400);
  });
  return app;
}

async function makeFileEntry(userId: string, body = "original") {
  const entry = await uploadDriveFile(db, config, {
    ...personal(userId),
    createdBy: userId,
    file: textFile("doc.txt", body),
  });
  return entry.id;
}

function jsonReq(uid: string, method: string, body?: unknown) {
  return {
    method,
    headers: { "x-uid": uid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describe("drive edit-lock routes", () => {
  test("acquire returns the editId; a second holder is rejected with 409 + lockBy", async () => {
    const userId = await seedUser();
    const entryId = await makeFileEntry(userId);
    const app = buildApp();

    const first = await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "POST", { editId: "edit-1" }));
    expect(first.status).toBe(200);
    expect((await first.json()).data.editId).toBe("edit-1");

    const second = await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "POST", { editId: "edit-2" }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("DRIVE_EDIT_LOCKED");
    expect(body.error.lockBy).toBe(userId);
  });

  test("live-content writes the live body; content-read prefers it; a stale editId is rejected", async () => {
    const userId = await seedUser();
    const entryId = await makeFileEntry(userId, "original");
    const app = buildApp();

    await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "POST", { editId: "edit-1" }));

    const saved = await app.request(`/drive/entries/${entryId}/live-content`, jsonReq(userId, "PATCH", { editId: "edit-1", content: "live edits" }));
    expect(saved.status).toBe(200);

    // GET /content prefers the live body over the (still-original) version blob.
    const content = await app.request(`/drive/entries/${entryId}/content?inline=true`, { headers: { "x-uid": userId } });
    expect(content.status).toBe(200);
    expect(await content.text()).toBe("live edits");

    const stale = await app.request(`/drive/entries/${entryId}/live-content`, jsonReq(userId, "PATCH", { editId: "stale", content: "nope" }));
    expect(stale.status).toBe(409);
  });

  test("heartbeat with a stale editId is rejected with 409", async () => {
    const userId = await seedUser();
    const entryId = await makeFileEntry(userId);
    const app = buildApp();

    await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "POST", { editId: "edit-1" }));

    const stale = await app.request(`/drive/entries/${entryId}/edit-lock/heartbeat`, jsonReq(userId, "PATCH", { editId: "stale" }));
    expect(stale.status).toBe(409);

    const fresh = await app.request(`/drive/entries/${entryId}/edit-lock/heartbeat`, jsonReq(userId, "PATCH", { editId: "edit-1" }));
    expect(fresh.status).toBe(200);
  });

  test("release frees the lock so a fresh acquire with a new editId succeeds", async () => {
    const userId = await seedUser();
    const entryId = await makeFileEntry(userId);
    const app = buildApp();

    await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "POST", { editId: "edit-1" }));

    const released = await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "DELETE", { editId: "edit-1" }));
    expect(released.status).toBe(200);
    expect((await released.json()).data.released).toBe(true);

    const reacquired = await app.request(`/drive/entries/${entryId}/edit-lock`, jsonReq(userId, "POST", { editId: "edit-2" }));
    expect(reacquired.status).toBe(200);
    expect((await reacquired.json()).data.editId).toBe("edit-2");
  });
});
