import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { FileStorageDriver } from "@/modules/file/storage/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { runS3OrphanSweepOnce } from "@/modules/file/s3-sweep";
import { files } from "@/modules/file/schema";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { confirmDriveUpload, presignDriveUpload } from "./drive.service";
import { driveEntries } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

const config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS"> = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_ATTACHMENTS_PER_RESOURCE: 20,
  UPLOADS_TOTAL_BYTES: 0,
  FILE_GC_MODE: "sync",
  FILE_PRESIGN_ENABLED: true,
  FILE_PRESIGN_TTL_SECONDS: 300,
};

// In-memory object store standing in for S3, exposing the optional driver
// capabilities (presignUpload/stat/list) the local driver lacks.
const store = new Map<string, { size: number; lastModified: number }>();
function putObject(key: string, size: number, lastModified: number): void {
  store.set(key, { size, lastModified });
}

const fakeS3: FileStorageDriver = {
  name: "s3",
  async put(key, data) {
    store.set(key, { size: (data as ArrayBuffer).byteLength, lastModified: Date.now() });
  },
  async getStream() {
    return new ReadableStream({ start: c => c.close() });
  },
  async delete(key) {
    store.delete(key);
  },
  async exists(key) {
    return store.has(key);
  },
  async presignUpload(key, opts) {
    return { url: `https://s3.test/${key}`, method: "PUT", headers: { "Content-Type": opts.contentType } };
  },
  async stat(key) {
    const o = store.get(key);
    return o ? { size: o.size } : null;
  },
  async list() {
    return [...store.entries()].map(([key, o]) => ({ key, size: o.size, lastModified: o.lastModified }));
  },
};

async function seedUser(): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `u-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

const sha = (c: string): string => c.repeat(64).slice(0, 64);

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-direct-upload-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  store.clear();
  __resetDriverRegistryForTests();
  registerDriver(fakeS3);
  setActiveDriver("s3");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("presignDriveUpload", () => {
  test("a new blob returns a presigned PUT and creates nothing yet", async () => {
    const userId = await seedUser();
    const res = await presignDriveUpload(db, config, {
      ownerType: "user",
      ownerId: userId,
      createdBy: userId,
      name: "photo.png",
      sha256: sha("a"),
      size: 1024,
      mimetype: "image/png",
    });
    expect(res.mode).toBe("upload");
    if (res.mode === "upload") {
      expect(res.upload.method).toBe("PUT");
      expect(res.upload.url).toContain(deriveStorageKey(sha("a")));
      expect(res.upload.headers["Content-Type"]).toBe("image/png");
    }
    expect((await db.select().from(files).all()).length).toBe(0);
    expect((await db.select().from(driveEntries).all()).length).toBe(0);
  });

  test("rejects an over-cap declared size with 413", async () => {
    const userId = await seedUser();
    await expect(presignDriveUpload(db, config, {
      ownerType: "user",
      ownerId: userId,
      createdBy: userId,
      name: "big.bin",
      sha256: sha("b"),
      size: config.MAX_UPLOAD_BYTES + 1,
      mimetype: "application/octet-stream",
    })).rejects.toThrow(/too large/i);
  });

  test("an already-stored blob finishes instantly (dedup) and creates the entry", async () => {
    const userId = await seedUser();
    // Confirm one upload so the blob is registered.
    putObject(deriveStorageKey(sha("c")), 2048, Date.now());
    await confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "first.png", sha256: sha("c"), mimetype: "image/png" });

    const res = await presignDriveUpload(db, config, {
      ownerType: "user",
      ownerId: userId,
      createdBy: userId,
      name: "second.png",
      sha256: sha("c"),
      size: 2048,
      mimetype: "image/png",
    });
    expect(res.mode).toBe("done");
    if (res.mode === "done")
      expect(res.entry.name).toBe("second.png");
    // One blob row (deduped), two drive entries / references.
    expect((await db.select().from(files).all()).length).toBe(1);
    expect((await db.select().from(driveEntries).all()).length).toBe(2);
  });

  test("a different user does NOT instant-dedup another user's blob (no cross-user poisoning)", async () => {
    const owner = await seedUser();
    putObject(deriveStorageKey(sha("f")), 2048, Date.now());
    await confirmDriveUpload(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, name: "owned.png", sha256: sha("f"), mimetype: "image/png" });

    // A second user presigning the same hash must be told to upload (re-PUT),
    // never handed the existing blob's content.
    const other = await seedUser();
    const res = await presignDriveUpload(db, config, {
      ownerType: "user",
      ownerId: other,
      createdBy: other,
      name: "guessed.png",
      sha256: sha("f"),
      size: 2048,
      mimetype: "image/png",
    });
    expect(res.mode).toBe("upload");
  });
});

describe("confirmDriveUpload", () => {
  test("creates the entry from the uploaded object's authoritative size", async () => {
    const userId = await seedUser();
    putObject(deriveStorageKey(sha("d")), 4096, Date.now());
    const entry = await confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "doc.png", sha256: sha("d"), mimetype: "image/png" });
    expect(entry.name).toBe("doc.png");
    const row = await db.select().from(files).where(eq(files.sha256, sha("d"))).get();
    expect(row?.size).toBe(4096);
    expect(row?.storageDriver).toBe("s3");
  });

  test("rejects when the object never landed in storage", async () => {
    const userId = await seedUser();
    await expect(confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "missing.png", sha256: sha("e"), mimetype: "image/png" }))
      .rejects
      .toThrow(/not found/i);
  });

  test("enforces the total quota against the authoritative stat size, not the declared one", async () => {
    const userId = await seedUser();
    // A 5 KiB object under a 4 KiB total quota — the client could have declared
    // 1 byte at presign, but confirm checks the real on-disk size.
    putObject(deriveStorageKey(sha("9")), 5 * 1024, Date.now());
    const quotaConfig = { ...config, UPLOADS_TOTAL_BYTES: 4 * 1024 };
    await expect(confirmDriveUpload(db, quotaConfig, { ownerType: "user", ownerId: userId, createdBy: userId, name: "over.png", sha256: sha("9"), mimetype: "image/png" }))
      .rejects
      .toThrow(/quota/i);
  });
});

describe("runS3OrphanSweepOnce", () => {
  test("deletes only unregistered objects older than the TTL", async () => {
    const userId = await seedUser();
    const now = Date.UTC(2026, 5, 22, 12, 0, 0);
    const hour = 60 * 60 * 1000;

    // Registered (confirmed) object — must be kept.
    putObject(deriveStorageKey(sha("1")), 100, now - 48 * hour);
    await confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "kept.png", sha256: sha("1"), mimetype: "image/png" });
    // Unregistered + old — must be swept.
    putObject(deriveStorageKey(sha("2")), 200, now - 48 * hour);
    // Unregistered + fresh — must be kept (a confirm may be in flight).
    putObject(deriveStorageKey(sha("3")), 300, now - 1 * hour);

    const deleted = await runS3OrphanSweepOnce(db, { ttlHours: 24, nowMs: now });
    expect(deleted).toBe(1);
    expect(store.has(deriveStorageKey(sha("1")))).toBe(true);
    expect(store.has(deriveStorageKey(sha("2")))).toBe(false);
    expect(store.has(deriveStorageKey(sha("3")))).toBe(true);
  });
});
