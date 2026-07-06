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
import { __clearPendingUploadsForTests } from "@/modules/file/storage/pending-uploads";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver, setActiveUploadDriver } from "@/modules/file/storage/registry";
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

const PRESIGN_BASE = "https://s3.test/";
// Hour-bucketed key shape (REFACTOR-038): <YYYYMMDDHH>/<26-char ULID>.
const KEY_SHAPE = /^\d{10}\/[0-9a-hjkmnp-tv-z]{26}$/;

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
    return { url: `${PRESIGN_BASE}${key}`, method: "PUT", headers: { "Content-Type": opts.contentType } };
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

/**
 * Run the client's upload leg: presign, extract the minted key from the
 * presigned URL, and drop an object of `size` bytes at it — the state a real
 * PUT leaves behind before confirm.
 */
async function presignAndPut(userId: string, contentSha: string, size: number, mtime = Date.now()): Promise<string> {
  const res = await presignDriveUpload(db, config, {
    ownerType: "user",
    ownerId: userId,
    createdBy: userId,
    name: "staged.bin",
    sha256: contentSha,
    size,
    mimetype: "application/octet-stream",
  });
  if (res.mode !== "upload")
    throw new Error("expected presign to return an upload");
  const key = res.upload.url.slice(PRESIGN_BASE.length);
  putObject(key, size, mtime);
  return key;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-direct-upload-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  store.clear();
  __clearPendingUploadsForTests();
  __resetDriverRegistryForTests();
  registerDriver(fakeS3);
  setActiveDriver("s3");
  // Direct-upload paths (presign/confirm) target the active UPLOAD driver.
  setActiveUploadDriver("s3");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("presignDriveUpload", () => {
  test("a new blob returns a presigned PUT for an hour-bucketed key and creates nothing yet", async () => {
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
      expect(res.upload.url.slice(PRESIGN_BASE.length)).toMatch(KEY_SHAPE);
      expect(res.upload.headers["Content-Type"]).toBe("image/png");
    }
    expect((await db.select().from(files).all()).length).toBe(0);
    expect((await db.select().from(driveEntries).all()).length).toBe(0);
  });

  test("re-presigning the same content reuses the pending key (concurrent duplicates share one object)", async () => {
    const userId = await seedUser();
    const input = { ownerType: "user" as const, ownerId: userId, createdBy: userId, name: "a.png", sha256: sha("k"), size: 512, mimetype: "image/png" };
    const first = await presignDriveUpload(db, config, input);
    const second = await presignDriveUpload(db, config, { ...input, name: "b.png" });
    if (first.mode !== "upload" || second.mode !== "upload")
      throw new Error("expected uploads");
    expect(second.upload.url).toBe(first.upload.url);
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
    // Complete one direct upload so the blob is registered.
    await presignAndPut(userId, sha("c"), 2048);
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
    await presignAndPut(owner, sha("f"), 2048);
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
  test("creates the entry from the uploaded object's authoritative size and the presigned key", async () => {
    const userId = await seedUser();
    // Declared 1 KiB at presign, but 4 KiB actually landed — confirm must
    // trust the stat, and the row must point at the presigned key.
    const key = await presignAndPut(userId, sha("d"), 4096);
    const entry = await confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "doc.png", sha256: sha("d"), mimetype: "image/png" });
    expect(entry.name).toBe("doc.png");
    const row = await db.select().from(files).where(eq(files.sha256, sha("d"))).get();
    expect(row?.size).toBe(4096);
    expect(row?.storageDriver).toBe("s3");
    expect(row?.storageKey).toBe(key);
    expect(row?.id).toBe(key.split("/")[1]!);
  });

  test("rejects when no presign session exists for the content (expired / restarted)", async () => {
    const userId = await seedUser();
    await expect(confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "missing.png", sha256: sha("e"), mimetype: "image/png" }))
      .rejects
      .toThrow(/not found/i);
  });

  test("rejects when the object never landed in storage", async () => {
    const userId = await seedUser();
    // Presign only — the client never PUT the bytes.
    await presignDriveUpload(db, config, {
      ownerType: "user",
      ownerId: userId,
      createdBy: userId,
      name: "ghost.png",
      sha256: sha("g"),
      size: 1024,
      mimetype: "image/png",
    });
    await expect(confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "ghost.png", sha256: sha("g"), mimetype: "image/png" }))
      .rejects
      .toThrow(/not found/i);
  });

  test("enforces the total quota against the authoritative stat size, not the declared one", async () => {
    const userId = await seedUser();
    // A 5 KiB object under a 4 KiB total quota — the client declared 1 KiB at
    // presign, but confirm checks the real on-disk size.
    await presignAndPut(userId, sha("9"), 5 * 1024);
    const quotaConfig = { ...config, UPLOADS_TOTAL_BYTES: 4 * 1024 };
    await expect(confirmDriveUpload(db, quotaConfig, { ownerType: "user", ownerId: userId, createdBy: userId, name: "over.png", sha256: sha("9"), mimetype: "image/png" }))
      .rejects
      .toThrow(/quota/i);
  });

  test("a different user CANNOT attach another user's blob via confirm by sha256 (FIX-048 IDOR)", async () => {
    // User A uploads + confirms a blob for real.
    const owner = await seedUser();
    await presignAndPut(owner, sha("7"), 3072);
    await confirmDriveUpload(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, name: "secret.png", sha256: sha("7"), mimetype: "image/png" });

    // User B knows the sha256 (e.g. leaked via a thumbnail ETag) and confirms
    // against their own folder WITHOUT ever uploading the bytes. The object is
    // present in storage, so a naive stat-only confirm would attach it — the
    // uploader-scoping guard must reject instead.
    const attacker = await seedUser();
    await expect(confirmDriveUpload(db, config, { ownerType: "user", ownerId: attacker, createdBy: attacker, name: "stolen.png", sha256: sha("7"), mimetype: "image/png" }))
      .rejects
      .toThrow(/not found/i);

    // No downloadable entry / reference was created for B, and A's blob refcount
    // was not bumped (the attach never happened).
    const attackerEntries = await db.select().from(driveEntries).where(eq(driveEntries.createdBy, attacker)).all();
    expect(attackerEntries.length).toBe(0);
    const blob = await db.select().from(files).where(eq(files.sha256, sha("7"))).get();
    expect(blob?.refCount).toBe(1);
    expect(blob?.uploadedBy).toBe(owner);
  });

  test("the original uploader can re-confirm their own blob (no dedup regression)", async () => {
    const owner = await seedUser();
    await presignAndPut(owner, sha("8"), 3072);
    await confirmDriveUpload(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, name: "first.png", sha256: sha("8"), mimetype: "image/png" });

    // A second confirm of the same hash by the same user dedups onto the single
    // stored blob (refcount bumped) and creates a second entry.
    const entry = await confirmDriveUpload(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, name: "second.png", sha256: sha("8"), mimetype: "image/png" });
    expect(entry.name).toBe("second.png");
    expect((await db.select().from(files).where(eq(files.sha256, sha("8"))).all()).length).toBe(1);
    const blob = await db.select().from(files).where(eq(files.sha256, sha("8"))).get();
    expect(blob?.refCount).toBe(2);
    expect((await db.select().from(driveEntries).where(eq(driveEntries.createdBy, owner)).all()).length).toBe(2);
  });
});

describe("runS3OrphanSweepOnce", () => {
  test("deletes only unregistered objects older than the TTL", async () => {
    const userId = await seedUser();
    const now = Date.UTC(2026, 5, 22, 12, 0, 0);
    const hour = 60 * 60 * 1000;

    // Registered (confirmed) object — must be kept even though it is old.
    const keptKey = await presignAndPut(userId, sha("1"), 100, now - 48 * hour);
    store.set(keptKey, { size: 100, lastModified: now - 48 * hour });
    await confirmDriveUpload(db, config, { ownerType: "user", ownerId: userId, createdBy: userId, name: "kept.png", sha256: sha("1"), mimetype: "image/png" });
    // Unregistered + old — must be swept.
    putObject("2026062010/01ORPHANOLD00000000000000A", 200, now - 48 * hour);
    // Unregistered + fresh — must be kept (a confirm may be in flight).
    putObject("2026062211/01ORPHANFRESH000000000000A", 300, now - 1 * hour);

    const deleted = await runS3OrphanSweepOnce(db, { ttlHours: 24, nowMs: now });
    expect(deleted).toBe(1);
    expect(store.has(keptKey)).toBe(true);
    expect(store.has("2026062010/01ORPHANOLD00000000000000A")).toBe(false);
    expect(store.has("2026062211/01ORPHANFRESH000000000000A")).toBe(true);
  });
});
