import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { groupRoutes } from "./groups.routes";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [groupRoutes]);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-groups-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

async function getDefault(cookie: string) {
  return buildApp().request("/account/groups/default", { headers: { Cookie: cookie } });
}

async function patchDefault(cookie: string, modules: string[]) {
  return buildApp().request("/account/groups/default", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify({ modules }),
  });
}

describe("GET/PATCH /account/groups/default (FEAT-043)", () => {
  test("GET → 401 without a session", async () => {
    expect((await buildApp().request("/account/groups/default")).status).toBe(401);
  });

  test("GET → 403 for a non-admin", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    expect((await getDefault(cookie)).status).toBe(403);
  });

  test("GET → 200 with an empty module list before any edit", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await getDefault(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { modules: [] } });
  });

  test("PATCH → 403 for a non-admin", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    expect((await patchDefault(cookie, ["contacts"])).status).toBe(403);
  });

  test("PATCH sets the modules (registry order) and GET reflects it", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await patchDefault(cookie, ["contacts", "drive"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { modules: ["drive", "contacts"] } });

    const after = await getDefault(cookie);
    expect((await after.json()).data.modules).toEqual(["drive", "contacts"]);
  });

  test("PATCH rejects unknown module keys with 422", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    expect((await patchDefault(cookie, ["contacts", "bogus"])).status).toBe(422);
  });
});
