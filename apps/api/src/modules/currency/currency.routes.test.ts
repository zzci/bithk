import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { setSetting } from "@/modules/settings/settings.service";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { currencyRoutes } from "./currency.routes";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [currencyRoutes]);
}

interface CurrencyBody {
  success: boolean;
  data: { builtin: string[]; custom: string[] };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-currency-routes-${Date.now()}-${testNanoid()}`);
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

describe("GET /currencies", () => {
  test("401 without a session", async () => {
    const res = await buildApp().request("/currencies");
    expect(res.status).toBe(401);
  });

  test("200 for a non-admin user; built-in list includes THB, custom empty", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/currencies", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as CurrencyBody;
    expect(body.success).toBe(true);
    expect(body.data.builtin).toContain("THB");
    expect(body.data.builtin).toContain("USD");
    expect(body.data.custom).toEqual([]);
  });

  test("merges admin-added custom codes and drops ones already built-in", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    await setSetting(db, "app.currencies", JSON.stringify(["AUD", "USD", "AUD"]));
    const res = await buildApp().request("/currencies", { headers: { Cookie: cookie } });
    const body = await res.json() as CurrencyBody;
    // USD is built-in (excluded); AUD deduped to a single entry.
    expect(body.data.custom).toEqual(["AUD"]);
  });

  test("malformed setting value degrades to an empty custom list", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    await setSetting(db, "app.currencies", "not-json");
    const res = await buildApp().request("/currencies", { headers: { Cookie: cookie } });
    const body = await res.json() as CurrencyBody;
    expect(body.data.custom).toEqual([]);
  });
});
