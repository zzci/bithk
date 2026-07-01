import type { AppDatabase } from "@/db";
import type { FileStorageDriver, StoredObject } from "@/modules/file/storage/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { runS3OrphanSweepOnce } from "@/modules/file/s3-sweep";
import { files } from "@/modules/file/schema";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

// In-memory object store standing in for the S3 backend. Insertion order is the
// enumeration order a paginated `listPage` walks.
const store = new Map<string, { size: number; lastModified: number }>();
// Continuation tokens the sweep sent, in order — asserts pages beyond the first
// are actually fetched.
let listCalls: (string | undefined)[] = [];

function putObject(key: string, lastModified: number, size = 100): void {
  store.set(key, { size, lastModified });
}

/**
 * Fake driver whose `listPage` pages the store in fixed-size slices, echoing a
 * continuation token (the next offset) until the listing is exhausted. The page
 * is snapshotted on the first call so deletes mid-sweep don't reshuffle indices,
 * matching a real bucket enumeration.
 */
function makePagingDriver(pageSize: number): FileStorageDriver {
  let snapshot: StoredObject[] = [];
  return {
    name: "s3",
    async put() {},
    async getStream() {
      return new ReadableStream({ start: c => c.close() });
    },
    async delete(key) {
      store.delete(key);
    },
    async exists(key) {
      return store.has(key);
    },
    async listPage(_prefix, continuationToken) {
      listCalls.push(continuationToken);
      if (!continuationToken)
        snapshot = [...store.entries()].map(([key, o]) => ({ key, size: o.size, lastModified: o.lastModified }));
      const offset = continuationToken ? Number(continuationToken) : 0;
      const objects = snapshot.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      return next < snapshot.length ? { objects, nextToken: String(next) } : { objects };
    },
  };
}

/** Single-page driver (no `listPage`) — exercises the sweep's `list` fallback. */
function makeSinglePageDriver(): FileStorageDriver {
  return {
    name: "s3",
    async put() {},
    async getStream() {
      return new ReadableStream({ start: c => c.close() });
    },
    async delete(key) {
      store.delete(key);
    },
    async exists(key) {
      return store.has(key);
    },
    async list() {
      return [...store.entries()].map(([key, o]) => ({ key, size: o.size, lastModified: o.lastModified }));
    },
  };
}

async function seedUser(): Promise<string> {
  const id = nanoid();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `u-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
  }).run();
  return id;
}

/** Register a blob in `files` so the sweep must keep the matching object. */
async function registerBlob(uploadedBy: string, key: string): Promise<void> {
  await db.insert(files).values({
    id: nanoid(),
    sha256: key.replace(/[^0-9a-f]/g, "").padEnd(64, "0").slice(0, 64),
    size: 100,
    mimetype: "application/octet-stream",
    storageDriver: "s3",
    storageKey: key,
    uploadedBy,
  }).run();
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-s3-sweep-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  store.clear();
  listCalls = [];
  __resetDriverRegistryForTests();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("runS3OrphanSweepOnce pagination", () => {
  test("sweeps orphans on every page and keeps registered/fresh blobs beyond page one", async () => {
    const userId = await seedUser();
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const hour = 60 * 60 * 1000;

    // Page 1 (offset 0): an old orphan (swept) + a fresh orphan (kept).
    putObject("ab/cd/orphan-old-1", now - 48 * hour);
    putObject("ab/cd/orphan-fresh", now - 1 * hour);
    // Page 2 (offset 2): an old orphan the pre-fix single-page code never saw
    // (swept) + a registered blob that must survive regardless of its page.
    putObject("ef/01/orphan-old-2", now - 48 * hour);
    putObject("ef/02/registered", now - 48 * hour);
    await registerBlob(userId, "ef/02/registered");

    registerDriver(makePagingDriver(2));
    setActiveDriver("s3");

    const deleted = await runS3OrphanSweepOnce(db, { ttlHours: 24, nowMs: now });

    expect(deleted).toBe(2);
    // Two pages fetched: the first (no token) and the second (continuation token).
    expect(listCalls).toEqual([undefined, "2"]);
    expect(store.has("ab/cd/orphan-old-1")).toBe(false);
    expect(store.has("ef/01/orphan-old-2")).toBe(false);
    expect(store.has("ab/cd/orphan-fresh")).toBe(true);
    expect(store.has("ef/02/registered")).toBe(true);
  });

  test("walks a >1000-object listing across multiple pages, considering every object", async () => {
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const old = now - 48 * 60 * 60 * 1000;
    // 1500 old orphans forces a second page at the real 1000-key S3 page cap.
    const total = 1500;
    for (let i = 0; i < total; i++)
      putObject(`ab/cd/orphan-${i.toString().padStart(5, "0")}`, old);

    registerDriver(makePagingDriver(1000));
    setActiveDriver("s3");

    const deleted = await runS3OrphanSweepOnce(db, { ttlHours: 24, nowMs: now });

    // Every orphan past the first page is reclaimed — the bug this fix closes.
    expect(deleted).toBe(total);
    expect(store.size).toBe(0);
    expect(listCalls).toEqual([undefined, "1000"]);
  });

  test("falls back to single-page `list` for drivers without `listPage`", async () => {
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const hour = 60 * 60 * 1000;
    putObject("ab/cd/orphan-old", now - 48 * hour);
    putObject("ab/cd/orphan-fresh", now - 1 * hour);

    registerDriver(makeSinglePageDriver());
    setActiveDriver("s3");

    const deleted = await runS3OrphanSweepOnce(db, { ttlHours: 24, nowMs: now });

    expect(deleted).toBe(1);
    expect(store.has("ab/cd/orphan-old")).toBe(false);
    expect(store.has("ab/cd/orphan-fresh")).toBe(true);
  });

  test("no-ops for a driver that lists nothing", async () => {
    const localLike: FileStorageDriver = {
      name: "local",
      async put() {},
      async getStream() {
        return new ReadableStream({ start: c => c.close() });
      },
      async delete() {},
      async exists() {
        return false;
      },
    };
    registerDriver(localLike);
    setActiveDriver("local");

    expect(await runS3OrphanSweepOnce(db, { ttlHours: 24, nowMs: Date.now() })).toBe(0);
  });
});
