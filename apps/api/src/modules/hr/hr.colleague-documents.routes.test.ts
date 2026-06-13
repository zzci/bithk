import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import { hrRoutes } from "./hr.routes";
// Registers the session-cookie auth provider that `authRequired` resolves through.
import "@/modules/account";

// Local driver streams bytes (no presign) so the download route returns 200.
const config = testConfig({ FILE_PRESIGN_ENABLED: false });

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [hrRoutes], config);
}

async function seedActiveUser(): Promise<string> {
  const id = testNanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/** Create a colleague (admin) and return its id. */
async function createColleague(adminCookie: string): Promise<string> {
  const userId = await seedActiveUser();
  const res = await buildApp().request("/hr/colleagues", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": adminCookie },
    body: JSON.stringify({ userId }),
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

function uploadReq(cookie: string, name = "passport.txt"): RequestInit {
  const fd = new FormData();
  fd.append("file", new File(["scan-bytes"], name, { type: "text/plain" }));
  return { method: "POST", headers: { Cookie: cookie }, body: fd };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-hr-docs-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("/hr/colleagues/:id/attachments", () => {
  test("uploads, lists, downloads, and deletes a personal document", async () => {
    const admin = await sessionCookieFor(db, "admin");
    const colleagueId = await createColleague(admin.cookie);

    const up = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments`, uploadReq(admin.cookie));
    expect(up.status).toBe(201);
    const upBody = await up.json() as { data: { id: string; filename: string } };
    expect(upBody.data.filename).toBe("passport.txt");
    const attachmentId = upBody.data.id;

    const list = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments`, { headers: { Cookie: admin.cookie } });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.map(a => a.id)).toContain(attachmentId);

    const dl = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments/${attachmentId}`, { headers: { Cookie: admin.cookie } });
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe("scan-bytes");

    const del = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments/${attachmentId}`, { method: "DELETE", headers: { Cookie: admin.cookie } });
    expect(del.status).toBe(200);

    const after = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments`, { headers: { Cookie: admin.cookie } });
    const afterBody = await after.json() as { data: unknown[] };
    expect(afterBody.data).toEqual([]);
  });

  test("uploading to a missing colleague is a 404", async () => {
    const admin = await sessionCookieFor(db, "admin");
    const res = await buildApp().request("/hr/colleagues/nope/attachments", uploadReq(admin.cookie));
    expect(res.status).toBe(404);
  });

  test("uploading without a file is a 400", async () => {
    const admin = await sessionCookieFor(db, "admin");
    const colleagueId = await createColleague(admin.cookie);
    const res = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments`, {
      method: "POST",
      headers: { Cookie: admin.cookie },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  test("an attachment id under the wrong colleague is a 404", async () => {
    const admin = await sessionCookieFor(db, "admin");
    const a = await createColleague(admin.cookie);
    const b = await createColleague(admin.cookie);
    const up = await buildApp().request(`/hr/colleagues/${a}/attachments`, uploadReq(admin.cookie));
    const upBody = await up.json() as { data: { id: string } };

    const res = await buildApp().request(`/hr/colleagues/${b}/attachments/${upBody.data.id}`, { headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(404);
  });

  test("a non-admin who is not the uploader cannot delete (403)", async () => {
    const admin = await sessionCookieFor(db, "admin");
    const other = await sessionCookieFor(db, "user");
    const colleagueId = await createColleague(admin.cookie);
    const up = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments`, uploadReq(admin.cookie));
    const upBody = await up.json() as { data: { id: string } };

    const res = await buildApp().request(`/hr/colleagues/${colleagueId}/attachments/${upBody.data.id}`, { method: "DELETE", headers: { Cookie: other.cookie } });
    expect(res.status).toBe(403);
  });
});
