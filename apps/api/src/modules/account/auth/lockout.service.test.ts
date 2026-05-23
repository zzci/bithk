import type { LockoutPolicy } from "./lockout.service";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { clearAllLockouts, clearFailures, isLocked, recordFailure } from "./lockout.service";
import { authLockouts } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const POLICY: LockoutPolicy = { threshold: 3, windowMs: 60_000 };

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-lockout-${Date.now()}-${nanoid()}`);
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

describe("isLocked", () => {
  test("an unseen key is unlocked", async () => {
    expect(await isLocked(db, "absent")).toEqual({ locked: false, retryAfterSeconds: 0 });
  });

  test("a key with failures below threshold (lockedUntil null) is unlocked", async () => {
    await recordFailure(db, "k", POLICY);
    expect((await isLocked(db, "k")).locked).toBe(false);
  });

  test("lazily clears an expired lock and reports unlocked", async () => {
    // Seed a row whose lock window is already in the past.
    await db.insert(authLockouts).values({ key: "k", failures: 3, lockedUntil: Date.now() - 1 });
    const state = await isLocked(db, "k");
    expect(state.locked).toBe(false);
    const row = await db.select().from(authLockouts).where(eq(authLockouts.key, "k")).get();
    expect(row).toBeUndefined();
  });
});

describe("recordFailure", () => {
  test("does not lock before the threshold is reached", async () => {
    expect((await recordFailure(db, "k", POLICY)).locked).toBe(false);
    expect((await recordFailure(db, "k", POLICY)).locked).toBe(false);
    expect((await isLocked(db, "k")).locked).toBe(false);
  });

  test("locks exactly on the threshold-th failure", async () => {
    await recordFailure(db, "k", POLICY);
    await recordFailure(db, "k", POLICY);
    const tripped = await recordFailure(db, "k", POLICY);
    expect(tripped.locked).toBe(true);
    expect(tripped.retryAfterSeconds).toBe(60);
    expect((await isLocked(db, "k")).locked).toBe(true);
  });

  test("retryAfterSeconds counts down toward the window end", async () => {
    await db.insert(authLockouts).values({ key: "k", failures: 3, lockedUntil: Date.now() + 30_000 });
    const state = await isLocked(db, "k");
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  test("keys are isolated from one another", async () => {
    await recordFailure(db, "a", POLICY);
    await recordFailure(db, "a", POLICY);
    await recordFailure(db, "a", POLICY);
    expect((await isLocked(db, "a")).locked).toBe(true);
    expect((await isLocked(db, "b")).locked).toBe(false);
  });
});

describe("clearFailures / clearAllLockouts", () => {
  test("clearFailures resets a single key", async () => {
    await recordFailure(db, "k", POLICY);
    await recordFailure(db, "k", POLICY);
    await recordFailure(db, "k", POLICY);
    expect((await isLocked(db, "k")).locked).toBe(true);
    await clearFailures(db, "k");
    expect((await isLocked(db, "k")).locked).toBe(false);
    // Counter is dropped, so the next failure starts from one again.
    expect((await recordFailure(db, "k", POLICY)).locked).toBe(false);
  });

  test("clearAllLockouts drops every key", async () => {
    await recordFailure(db, "a", POLICY);
    await recordFailure(db, "b", POLICY);
    await clearAllLockouts(db);
    expect(await db.select().from(authLockouts).all()).toHaveLength(0);
  });
});
